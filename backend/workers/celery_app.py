"""Celery app — broker + result backend = Redis (Phase 7). Beat syncs KB every 30 min."""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.persistence.redis import broker_url, result_backend_url, transport_options

celery_app = Celery(
    "it_help_chatbot",
    broker=broker_url(),
    backend=result_backend_url(),  # DB 1 for results, DB 0 for broker (standalone keeps split)
    include=["workers.sync_tasks", "workers.reclassify_task", "workers.retention_tasks"],
)

# Sentinel HA (Phase 10): kombu needs the master_name transport option.
celery_app.conf.broker_transport_options = transport_options()
celery_app.conf.result_backend_transport_options = transport_options()

from app.retention import NIGHTLY_UTC_HOUR  # single source for the schedule label + crontab

celery_app.conf.beat_schedule = {
    "sync-kb": {"task": "workers.sync_tasks.sync_kb", "schedule": crontab(minute="*/30")},
    # 03:15 UTC — after the 19:30 nightly database backup, before the working day. Cheap:
    # one GET per mirrored key, with no model calls.
    "reconcile-jira": {"task": "workers.sync_tasks.reconcile_jira", "schedule": crontab(hour="3", minute="15")},
    # 04:10 UTC — after the KB sync, fill only the blanks in newly created domains.
    "backfill-domain-profiles": {"task": "workers.sync_tasks.backfill_domain_profiles",
                                 "schedule": crontab(hour="4", minute="10")},
    # 00:00 Asia/Singapore = 16:00 UTC (Singapore has no DST, so this never drifts). Its own
    # slot: deleting user data must not share a worker moment with the KB sync, and the log
    # line stays attributable.
    "retention-purge": {"task": "workers.retention_tasks.purge_expired",
                        "schedule": crontab(hour=str(NIGHTLY_UTC_HOUR), minute="0")},
}
celery_app.conf.timezone = "UTC"
celery_app.conf.task_serializer = "json"
celery_app.conf.result_serializer = "json"
celery_app.conf.accept_content = ["json"]
