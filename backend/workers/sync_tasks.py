"""Celery tasks — scheduled KB sync (Phase 7)."""
from __future__ import annotations

from app.knowledge.ingest import sync_all
from workers.celery_app import celery_app


@celery_app.task(name="workers.sync_tasks.sync_kb")
def sync_kb() -> dict:
    return sync_all()


@celery_app.task(name="workers.sync_tasks.reconcile_jira")
def reconcile_jira_task() -> dict:
    """Nightly: drop tickets deleted in Jira, adopt statuses changed there."""
    from app.integrations.jira_reconcile import reconcile_jira

    return reconcile_jira(limit=500)


@celery_app.task(name="workers.sync_tasks.backfill_domain_profiles")
def backfill_domain_profiles(limit: int = 10) -> dict:
    """Nightly: draft the missing half of a domain profile.

    Only fills BLANKS — a description or keyword list an admin wrote is never touched, so this
    cannot drift away from a deliberate edit. Runs after the KB sync so a domain created
    yesterday already has article titles to be grounded in. Bounded to `limit` LLM calls per
    night so an install with many domains cannot run up a bill in one go.
    """
    from sqlalchemy import text

    from app.classifier.profile_suggest import suggest_profile
    from app.persistence.database import SessionLocal

    filled: list[str] = []
    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT id, domain_key, display_name, description, keywords FROM classifier_domains "
            "WHERE is_active = true AND (description IS NULL OR description = '' "
            "      OR keywords IS NULL OR keywords = '[]'::jsonb) "
            "ORDER BY updated_at ASC LIMIT :n"), {"n": int(limit)}).mappings().all()
        for row in rows:
            titles = [r["title"] for r in s.execute(
                text("SELECT title FROM kb_meta WHERE lower(domain) = :k AND title IS NOT NULL "
                     "ORDER BY last_synced DESC LIMIT 25"),
                {"k": row["domain_key"]}).mappings().all()]
            out = suggest_profile(key=row["domain_key"], name=row["display_name"] or "",
                                  description=row["description"] or "",
                                  keywords=list(row["keywords"] or []), titles=titles)
            if not out:
                continue
            params = {"id": row["id"]}
            sets = []
            if not (row["description"] or "").strip() and out.get("description"):
                sets.append("description = :desc")
                params["desc"] = out["description"]
            if not list(row["keywords"] or []) and out.get("keywords"):
                sets.append("keywords = CAST(:kw AS jsonb)")
                params["kw"] = __import__("json").dumps(out["keywords"])
            if not sets:
                continue
            s.execute(text(f"UPDATE classifier_domains SET {', '.join(sets)}, updated_at = now() "
                           "WHERE id = :id"), params)
            s.commit()
            filled.append(row["domain_key"])

    if filled:
        from app.classifier.engine import reload_rules_cache

        reload_rules_cache()
    return {"filled": filled, "checked": len(rows)}
