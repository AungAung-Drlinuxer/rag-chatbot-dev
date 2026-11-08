"""Celery tasks — scheduled KB sync (Phase 7)."""
from __future__ import annotations

from app.knowledge.ingest import sync_all
from workers.celery_app import celery_app


@celery_app.task(name="workers.sync_tasks.sync_kb")
def sync_kb() -> dict:
    return sync_all()
