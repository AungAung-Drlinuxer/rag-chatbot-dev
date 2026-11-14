"""Celery task — nightly retention purge (00:00 Asia/Singapore, 16:00 UTC).

Kept separate from the KB sync: retention deletes user data, so it gets its own schedule
and its own log line, and a failure here can never take the knowledge base down with it.
"""
from __future__ import annotations

from workers.celery_app import celery_app


@celery_app.task(name="workers.retention_tasks.purge_expired")
def purge_expired() -> dict:
    """Apply the retention policy. A no-op when both windows are "keep forever"."""
    from app.retention import get_policy, purge

    policy = get_policy()
    if not policy.get("conversations_days") and not policy.get("audit_days"):
        return {"skipped": "keep forever", "removed": {}}
    return {"removed": purge(policy), "policy": policy}
