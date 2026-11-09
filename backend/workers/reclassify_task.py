"""Re-classify the KB as a Celery task.

It used to be a thread inside the web worker, so a deploy or a recycle froze the run at
whatever percentage it had reached. On Celery the work survives a backend restart and the
status row (RuntimeKv) carries the heartbeat the UI needs to tell "slow" from "dead".
"""
from __future__ import annotations

from app.knowledge.reclassify import run_reclassify
from workers.celery_app import celery_app


@celery_app.task(
    bind=True,
    name="workers.reclassify_task.reclassify",
    soft_time_limit=1500,
    time_limit=1800,
)
def reclassify_task(self, limit: int = 250, apply: bool = False) -> dict:
    result = run_reclassify(limit=limit, apply=apply)
    return {"state": result.get("state"), "total": result.get("total"),
            "changed": result.get("changed"), "done": result.get("done")}
