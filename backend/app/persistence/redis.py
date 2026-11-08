"""Redis client — standalone or Sentinel HA, switched by config (Phase 10).

The project's Celery broker needs a URL; the app may also need a direct Redis client for
cache/counters. This module centralises:
  - `broker_url()` / `result_backend_url()`  → Celery connection strings
  - `get_redis()`                           → direct `redis.Redis` (standalone or sentinel master)

Standalone (default)  — REDIS_URL, e.g. redis://localhost:6380/0
Sentinel (HA)         — REDIS_MODE=sentinel + REDIS_SENTINELS + REDIS_MASTER_NAME.
                        kombu/celery sentinel URL:
                        sentinel://h1:26379;alt=h2:26379;alt=h3:26379:6379/0
                        (requires broker_transport_options {'master_name': ...})
                        NOTE: Celery broker/backend DB-0/DB-1 split works on Sentinel
                        (multi-DB is fine), NOT on Redis Cluster (DB 0 only).
"""
from __future__ import annotations

from app.config import SETTINGS


def _sentinel_hosts() -> list[tuple[str, int]]:
    """Parse REDIS_SENTINELS 'h1:p,h2:p,h3:p' → [('h1',26379), ...]."""
    out: list[tuple[str, int]] = []
    for chunk in [c.strip() for c in SETTINGS.redis_sentinels.split(",") if c.strip()]:
        host, _, port = chunk.partition(":")
        out.append((host, int(port or 26379)))
    return out


def _sentinel_kombu_url(db: int) -> str:
    """kombu/celery sentinel broker URL: sentinel://[:PASSWORD@]h1:26379[;alt=h2:26379]/<db>.

    kombu discovers the CURRENT master (host:port) from the sentinel (get-master-addr-by-name),
    so the master's redis port is NOT in the URL. Password auths to both the sentinel (requirepass)
    and the master (requirepass) — same REDIS_PASSWORD.
    """
    hosts = _sentinel_hosts()
    if not hosts:
        raise ValueError("REDIS_SENTINELS is empty (sentinel mode requires sentinel addresses)")
    host, port = hosts[0]
    alts = "".join(f";alt={h}:{p}" for h, p in hosts[1:])
    pw = SETTINGS.redis_password
    auth = f":{pw}@" if pw else ""
    return f"sentinel://{auth}{host}:{port}{alts}/{db}"


def _with_password(url: str) -> str:
    """Return `url` carrying REDIS_PASSWORD when it does not already carry one.

    WHY: the deployment keeps the password in its own `REDIS_PASSWORD` secret key and
    leaves `REDIS_URL` credential-free (`redis://redis-service…:6379/0`). The client used
    to be built from that bare URL, so it never sent AUTH and every call failed with
    "AuthenticationError: Authentication required" — the health panel then reported Redis
    as Down while `redis-cli -a <the same password>` answered PING. One connection path
    must own the credentials.
    """
    from urllib.parse import quote, urlsplit, urlunsplit

    pw = SETTINGS.redis_password
    parts = urlsplit(url)
    if not pw or parts.password:
        return url
    user = quote(parts.username or "", safe="")
    netloc = f"{user}:{quote(pw, safe='')}@{parts.hostname}"
    if parts.port:
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def broker_url() -> str:
    """Celery broker connection string (DB 0)."""
    if SETTINGS.redis_mode == "sentinel":
        return _sentinel_kombu_url(0)
    return _with_password(SETTINGS.redis_url)


def result_backend_url() -> str:
    """Celery results backend (DB 1 — standalone keeps the /0 → /1 split)."""
    if SETTINGS.redis_mode == "sentinel":
        return _sentinel_kombu_url(1)
    return _with_password(SETTINGS.redis_url.replace("/0", "/1"))


def transport_options() -> dict:
    """Broker/backend transport options (master_name for Sentinel).

    kombu/redis-py do NOT AUTH to the Sentinel via the URL password — the Sentinel
    connection needs ``sentinel_kwargs``. Without it the Sentinel (which has
    ``requirepass``) rejects discovery with "Authentication required".
    """
    if SETTINGS.redis_mode == "sentinel":
        opts = {"master_name": SETTINGS.redis_master_name}
        if SETTINGS.redis_password:
            opts["sentinel_kwargs"] = {"password": SETTINGS.redis_password}
        return opts
    return {}


def get_redis():
    """Return a `redis.Redis` for direct use (standalone or sentinel master)."""
    import redis

    if SETTINGS.redis_mode == "sentinel":
        sentinel_kwargs = {"password": SETTINGS.redis_password} if SETTINGS.redis_password else {}
        sentinel = redis.sentinel.Sentinel(
            _sentinel_hosts(),
            sentinel_kwargs=sentinel_kwargs,
            password=SETTINGS.redis_password or None,
            socket_timeout=5,
        )
        return sentinel.master_for(SETTINGS.redis_master_name, redis.Redis)
    return redis.Redis.from_url(_with_password(SETTINGS.redis_url))
