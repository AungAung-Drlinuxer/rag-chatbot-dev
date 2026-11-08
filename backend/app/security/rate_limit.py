"""Distributed rate limiting — Redis fixed-window counters (no new dependencies).

v1.1.8 — the API previously had NO rate limiting: any logged-in user could loop
the LLM endpoint and burn provider budget. This module adds per-user / per-IP
limits backed by Redis (shared across all backend pods, HPA-safe).

Rules (default tiers):
  chat/stream   5 / min / user      (LLM cost — the endpoint to protect)
  escalate      3 / min / user      (ticket spam defense)
  auth/login    5 / min / IP        (brute-force)
  everything    60 / min / user     (read APIs, default ceiling)

Exceeded requests get 429 + Retry-After. Fail-open: if Redis is unreachable
the request proceeds (availability over strictness — documented trade-off).

Usage in routers:
    from app.security.rate_limit import limit
    @router.post("/api/chat/stream")
    def chat(...):
        ...
"""
from __future__ import annotations

import inspect
import logging
import time
from functools import wraps

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("ratelimit")

# (requests, window_seconds) per rule name
LIMITS: dict[str, tuple[int, int]] = {
    "chat": (5, 60),
    "escalate": (3, 60),
    "login": (5, 60),      # keyed by client IP
    "default": (60, 60),   # general API budget per user
}

ENABLED = True


def _redis():
    """Best-effort shared redis client; None when unavailable (fail-open)."""
    try:
        from app.persistence.redis import get_redis
        return get_redis()
    except Exception as exc:
        logger.debug("rate limiter: redis unavailable (%s) — failing open", exc)
        return None


def check_limit(rule: str, key: str) -> tuple[bool, int]:
    """Fixed-window counter in Redis. Returns (allowed, retry_after_seconds)."""
    if not ENABLED:
        return True, 0
    r = _redis()
    if r is None:
        return True, 0

    max_reqs, window = LIMITS[rule]
    bucket = int(time.time() // window)
    redis_key = f"rl:{rule}:{key}:{bucket}"
    try:
        pipe = r.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, window + 5)
        count = int(pipe.execute()[0])
    except Exception as exc:
        logger.debug("rate limiter: redis error — failing open (%s)", exc)
        return True, 0

    if count > max_reqs:
        retry_after = window - int(time.time() % window) + 1
        logger.warning("RATE LIMIT %s exceeded by %s (%d/%d)", rule, key, count, max_reqs)
        return False, retry_after
    return True, 0


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else None) or (
        request.client.host if request.client else "unknown"
    )


def _too_many(rule: str, retry_after: int) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        headers={
            "Retry-After": str(max(1, retry_after)),
            "X-RateLimit-Rule": rule,
        },
        content={"detail": f"Rate limit exceeded for '{rule}'. Please retry shortly."},
    )


def _resolve_key(rule: str, by_ip: bool, request: Request | None, kwargs: dict, args: tuple):
    if by_ip:
        if request is None:
            return True, 0, "ip:unknown"
        return True, 0, "ip:" + _client_ip(request)
    # v1.1.8 — user kwarg (FastAPI injects dependencies by keyword)
    user = kwargs.get("user")
    if isinstance(user, str) and user:
        return True, 0, f"user:{user}"
    # fallback: scan positional args for a username-looking string
    for a in args:
        if isinstance(a, str) and a and not a.startswith("{"):
            return True, 0, f"user:{a[:40]}"
    return True, 0, "ip:unknown"


def limit(rule: str, by_ip: bool = False):
    """FastAPI route decorator: enforce the rule before the handler runs.

    Key: authenticated `user` kwarg when present, else client IP.
    Works on both sync and async handlers; request may be positional or kwarg.
    """

    def decorator(fn):
        is_async = inspect.iscoroutinefunction(fn)

        @wraps(fn)
        async def awrapper(*args, **kwargs):
            request = kwargs.get("request") or next(
                (a for a in args if isinstance(a, Request)), None)
            _, retry, key = _resolve_key(rule, by_ip, request, kwargs, args)
            allowed, retry_after = check_limit(rule, key)
            if not allowed:
                return _too_many(rule, retry_after)
            return await fn(*args, **kwargs)

        @wraps(fn)
        def swrapper(*args, **kwargs):
            request = kwargs.get("request") or next(
                (a for a in args if isinstance(a, Request)), None)
            _, retry, key = _resolve_key(rule, by_ip, request, kwargs, args)
            allowed, retry_after = check_limit(rule, key)
            if not allowed:
                return _too_many(rule, retry_after)
            return fn(*args, **kwargs)

        return awrapper if is_async else swrapper

    return decorator