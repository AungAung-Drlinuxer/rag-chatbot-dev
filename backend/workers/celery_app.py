"""Celery app — broker + result backend = Redis (Phase 7). Beat syncs KB every 30 min."""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.persistence.redis import broker_url, result_backend_url, transport_options

celery_app = Celery(
    "it_help_chatbot",
    broker=broker_url(),
    backend=result_backend_url(),  # DB 1 for results, DB 0 for broker (standalone keeps split)
    include=["workers.sync_tasks"],
)

# Sentinel HA (Phase 10): kombu needs the master_name transport option.
celery_app.conf.broker_transport_options = transport_options()
celery_app.conf.result_backend_transport_options = transport_options()

celery_app.conf.beat_schedule = {
    "sync-kb": {"task": "workers.sync_tasks.sync_kb", "schedule": crontab(minute="*/30")},
}
celery_app.conf.timezone = "UTC"
celery_app.conf.task_serializer = "json"
celery_app.conf.result_serializer = "json"
celery_app.conf.accept_content = ["json"]
