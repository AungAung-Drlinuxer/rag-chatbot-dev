"""Retention for conversation history and the audit trail.

Both tables grow without bound: every question writes a session + two messages, every
action writes an audit row. An admin decides how long to keep them; this module is the
only place that reads that decision, counts what it would remove, and removes it.

Rules that are deliberate, not defaults:
  * `None` days means KEEP FOREVER. A missing key is not permission to delete.
  * Pinned conversations are never removed by retention — a pin is a person saying
    "this one still matters", and a scheduled job must not overrule that.
  * Preview and purge share one predicate (`_cutoff`, `_scope`), so what the dialog counts
    is exactly what the job deletes.
  * Deleting is batched: a year of chat can be hundreds of thousands of rows, and one
    transaction that size locks the table for everyone else.
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

logger = logging.getLogger("retention")

KEY = "retention"

# The window closes at local midnight in Singapore. Singapore is UTC+8 all year (no DST), so a
# fixed UTC hour is exact — kept in one place so the crontab and the settings page cannot disagree.
NIGHTLY_UTC_HOUR = 16
NIGHTLY_LABEL = "00:00 Singapore (16:00 UTC)"
LAST = "retention_last_run"
ALLOWED_DAYS = {30, 90, 180, 365}
BATCH = 2000

DEFAULTS = {"conversations_days": 365, "audit_days": 365}


def _session():
    from app.persistence.database import SessionLocal

    return SessionLocal()


def get_policy() -> dict:
    """Current policy; `None` for either field means keep forever."""
    policy = dict(DEFAULTS)
    with _session() as s:
        row = s.execute(text("SELECT value FROM system_settings WHERE key = :k"), {"k": KEY}).first()
    if row:
        try:
            val = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            if isinstance(val, dict):
                policy.update(val)
        except Exception as exc:  # a corrupt row must not crash the settings page
            logger.warning("retention policy unreadable (%s); using defaults", exc)
    for k in ("conversations_days", "audit_days"):
        v = policy.get(k)
        policy[k] = int(v) if v not in (None, "", 0) else None
    return policy


def set_policy(conversations_days, audit_days) -> dict:
    """Validate before storing: only the offered windows, or None (keep forever)."""
    clean: dict = {}
    for key, value in (("conversations_days", conversations_days), ("audit_days", audit_days)):
        if value in (None, "", "forever", 0, "0"):
            clean[key] = None
            continue
        days = int(value)
        if days not in ALLOWED_DAYS:
            raise ValueError(f"{key} must be one of {sorted(ALLOWED_DAYS)} days, or null to keep forever")
        clean[key] = days
    with _session() as s:
        s.execute(text(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": KEY, "v": json.dumps(clean)})
        s.commit()
    return get_policy()


def _cutoff(days: int | None, now: datetime | None = None) -> datetime | None:
    if not days:
        return None
    return (now or datetime.now(UTC)) - timedelta(days=days)


def scope_counts(policy: dict | None = None) -> dict:
    """How many rows each retention window would remove right now."""
    policy = policy or get_policy()
    now = datetime.now(UTC)
    out = {"conversations": 0, "messages": 0, "audit": 0, "kept_pinned": 0}
    with _session() as s:
        cut = _cutoff(policy.get("conversations_days"), now)
        if cut:
            out["conversations"] = s.execute(text(
                "SELECT count(*) FROM chat_sessions "
                "WHERE started_at < :c AND coalesce(is_pinned, false) = false"
            ), {"c": cut}).scalar() or 0
            out["messages"] = s.execute(text(
                "SELECT count(*) FROM chat_messages m JOIN chat_sessions c ON c.id = m.session_id "
                "WHERE c.started_at < :c AND coalesce(c.is_pinned, false) = false"
            ), {"c": cut}).scalar() or 0
            out["kept_pinned"] = s.execute(text(
                "SELECT count(*) FROM chat_sessions "
                "WHERE started_at < :c AND coalesce(is_pinned, false) = true"
            ), {"c": cut}).scalar() or 0
        cut_a = _cutoff(policy.get("audit_days"), now)
        if cut_a:
            out["audit"] = s.execute(text(
                "SELECT count(*) FROM audit_log WHERE created_at < :c"
            ), {"c": cut_a}).scalar() or 0
    return out


def totals() -> dict:
    """What is stored right now — the denominator for the preview.

    "0 to remove" is only meaningful next to "20 stored": without it the panel looks like
    it does not know the data exists."""
    with _session() as s:
        return {
            "conversations": s.execute(text("SELECT count(*) FROM chat_sessions")).scalar() or 0,
            "messages": s.execute(text("SELECT count(*) FROM chat_messages")).scalar() or 0,
            "audit": s.execute(text("SELECT count(*) FROM audit_log")).scalar() or 0,
            "pinned": s.execute(text(
                "SELECT count(*) FROM chat_sessions WHERE coalesce(is_pinned, false) = true"
            )).scalar() or 0,
        }


def oldest() -> dict:
    """Age of the oldest row in each scope, so an admin can see how far back the data goes."""
    with _session() as s:
        return {
            "conversations": s.execute(text("SELECT min(started_at) FROM chat_sessions")).scalar(),
            "audit": s.execute(text("SELECT min(created_at) FROM audit_log")).scalar(),
        }


def purge(policy: dict | None = None) -> dict:
    """Delete what the policy says is expired. Returns what was actually removed."""
    policy = policy or get_policy()
    now = datetime.now(UTC)
    removed = {"conversations": 0, "messages": 0, "audit": 0}
    with _session() as s:
        cut = _cutoff(policy.get("conversations_days"), now)
        if cut:
            # Messages first: the FK points at the session, so deleting parent rows first
            # either fails or leaves orphans depending on the constraint's mood.
            while True:
                ids = [str(r[0]) for r in s.execute(text(
                    "SELECT id FROM chat_sessions "
                    "WHERE started_at < :c AND coalesce(is_pinned, false) = false "
                    "LIMIT :n"
                ), {"c": cut, "n": BATCH}).all()]
                if not ids:
                    break
                # Explicit cast: psycopg2 sends a list of strings, and Postgres will not
                # compare uuid = text implicitly.
                mres = s.execute(
                    text("DELETE FROM chat_messages WHERE session_id = ANY(CAST(:ids AS uuid[]))"),
                    {"ids": ids},
                )
                removed["messages"] += mres.rowcount or 0
                res = s.execute(text("DELETE FROM chat_sessions WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                {"ids": ids})
                removed["conversations"] += res.rowcount or 0
                s.commit()
                if len(ids) < BATCH:
                    break
        cut_a = _cutoff(policy.get("audit_days"), now)
        if cut_a:
            while True:
                res = s.execute(text(
                    "DELETE FROM audit_log WHERE id IN ("
                    "  SELECT id FROM audit_log WHERE created_at < :c LIMIT :n)"
                ), {"c": cut_a, "n": BATCH})
                s.commit()
                removed["audit"] += res.rowcount or 0
                if not res.rowcount or res.rowcount < BATCH:
                    break
        s.execute(text(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": LAST, "v": json.dumps({"at": now.isoformat(), "removed": removed,
                                        "policy": policy})})
        s.commit()
    logger.info("retention removed %s", removed)
    return removed


def last_run() -> dict | None:
    with _session() as s:
        row = s.execute(text("SELECT value FROM system_settings WHERE key = :k"), {"k": LAST}).first()
    if not row:
        return None
    try:
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    except Exception:
        return None
