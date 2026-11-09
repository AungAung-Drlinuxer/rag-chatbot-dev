"""Distributed rate limiting — Redis fixed-window counters (no new dependencies).

v1.1.8 — the API previously had NO rate limiting: any logged-in user could loop
the LLM endpoint and burn provider budget. This module adds per-user / per-IP
limits backed by Redis (shared across all backend pods, HPA-safe).

Rules (default tiers):
  chat/stream   10 / min / user     (LLM cost — the endpoint to protect)
  escalate      5  / min / user     (ticket spam defense)
  auth/login    5  / min / IP       (brute-force)
  everything    240 / min / user    (read APIs, default ceiling)

Each ceiling is overridable without a rebuild: RATE_LIMIT_CHAT_PER_MIN,
RATE_LIMIT_ESCALATE_PER_MIN, RATE_LIMIT_LOGIN_PER_MIN, RATE_LIMIT_DEFAULT_PER_MIN.

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
from starlette.concurrency import run_in_threadpool
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("ratelimit")

# (requests, window_seconds) per rule name.
#
# The default tier is a ceiling, not a usage budget: one page load of this UI fires the
# dashboard, conversations, settings, domains and ticket lookups back to back, so 60/min
# throttled a normal session (observed: 173 requests in one minute, every one legitimate).
# 240/min still stops a runaway loop — the LLM endpoints have their own much stricter
# rules, which is where the real cost sits.
def _int_env(name: str, default: int) -> int:
    import os

    try:
        return max(1, int(os.getenv(name, "") or default))
    except ValueError:
        return default


LIMITS: dict[str, tuple[int, int]] = {
    "chat": (_int_env("RATE_LIMIT_CHAT_PER_MIN", 10), 60),
    "escalate": (_int_env("RATE_LIMIT_ESCALATE_PER_MIN", 5), 60),
    "login": (_int_env("RATE_LIMIT_LOGIN_PER_MIN", 5), 60),      # keyed by client IP
    "default": (_int_env("RATE_LIMIT_DEFAULT_PER_MIN", 240), 60),  # general API budget
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
        # One audit row per key per window. Logging every rejected request turned a burst
        # into hundreds of identical "API Rate Limit" rows on the Overview page.
        try:
            first = r.set(f"rl:audit:{rule}:{key}:{bucket}", "1", ex=window, nx=True)
            if first:
                from app.observability.audit import audit
                user_part = key.replace("user:", "") if key.startswith("user:") else key
                audit("guardrail.rate_limit", user_part,
                      detail=f"exceeded {max_reqs} req/{window}s threshold ({rule}), temporarily throttled")
        except Exception as _exc:
            logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
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


# ============================================================
# Global ceiling — the `default` tier, applied to every request
# ============================================================
# The decorator above only covers the endpoints that carry `@limit(...)`. Everything else
# (knowledge list, users, tickets, dashboard, admin) was uncounted, so the documented
# "60/min for the rest" existed only in this module's docstring. This middleware makes
# that real. Routes with a stricter decorator keep it — both counters run, and the
# stricter one is the one that will trip.
_SKIP_PATHS = {"/health", "/metrics", "/favicon.ico", "/openapi.json", "/docs", "/redoc"}


class GlobalRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-user (else per-IP) ceiling on every request that isn't a probe or a static file.

    Keyed by the JWT subject when a token is present, so one user cannot burn the
    instance's budget for everyone behind the same NAT. Fails open when Redis is down,
    like the decorator: an outage of the limiter must not become an outage of the app.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or path in _SKIP_PATHS or path.startswith("/assets/"):
            return await call_next(request)

        key = "ip:" + _client_ip(request)
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            try:
                from app.auth.jwt import decode_token

                sub = decode_token(auth[7:].strip())
                if sub:
                    key = f"user:{sub}"
            except Exception as exc:  # invalid/expired token → the route will 401 anyway
                logger.debug("anonymous rate-limit key (%s): %s", type(exc).__name__, exc)

        allowed, retry_after = await run_in_threadpool(check_limit, "default", key)
        if not allowed:
            return _too_many("default", retry_after)
        return await call_next(request)
