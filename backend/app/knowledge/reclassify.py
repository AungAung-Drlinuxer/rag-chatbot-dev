"""KB re-classification audit (P3c).

WHAT
----
Runs the LLM classifier over every article in `kb_meta` and reports the articles
whose domain should change, then optionally applies them.

WHY A BACKGROUND THREAD
-----------------------
229 articles x ~1.3s per LLM call is ~5 minutes — far past any gateway timeout, so
this cannot be a synchronous request. There is no Celery task module in this
codebase (the beat schedule drives `sync_all` directly), so the job runs in a
daemon thread and publishes progress to RuntimeKv, which the Knowledge page polls.

Trade-off, stated plainly: a pod restart mid-run aborts the job. It is idempotent
(just re-run it) and it never deletes anything, so the failure mode is "nothing
happened", not corruption.

APPLY
-----
Updating a domain does NOT change the embedding (the content hash covers title and
body only), so there is nothing to re-embed. Both the article row and the stored
chunk metadata are updated in place, otherwise retrieval would keep filtering on
the old domain and nothing would actually change.
"""
from __future__ import annotations

import json
import logging
import threading
import time

logger = logging.getLogger("knowledge.reclassify")

_STATUS_KEY = "kb_reclassify_status"
_LOCK = threading.Lock()
_thread: threading.Thread | None = None

EMPTY_STATUS = {
    "state": "idle", "total": 0, "done": 0, "changed": 0,
    "started_at": None, "finished_at": None, "applied": False,
    "error": None, "changes": [],
}


def _write_status(payload: dict) -> None:
    from app.persistence.models import RuntimeKv
    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        row = s.get(RuntimeKv, _STATUS_KEY)
        if row is None:
            s.add(RuntimeKv(key=_STATUS_KEY, value=json.dumps(payload)))
        else:
            row.value = json.dumps(payload)
        s.commit()


def reclassify_status() -> dict:
    from app.persistence.models import RuntimeKv
    from app.persistence.database import SessionLocal

    try:
        with SessionLocal() as s:
            row = s.get(RuntimeKv, _STATUS_KEY)
            if row and row.value:
                data = json.loads(row.value) if isinstance(row.value, str) else row.value
                return {**EMPTY_STATUS, **data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("reclassify status unreadable: %s", exc)
    return dict(EMPTY_STATUS)


def _apply_change(page_id: str, domain: str) -> int:
    """Move one article to a new domain. Returns rows of chunk metadata touched."""
    from sqlalchemy import text

    from app.persistence.database import SessionLocal, engine

    with SessionLocal() as s:
        s.execute(text("UPDATE kb_meta SET domain = :d WHERE page_id = :p"),
                  {"d": domain, "p": page_id})
        s.commit()

    # `cmetadata` is json (not jsonb) in this schema, so round-trip through jsonb to
    # get the merge operator, then cast back.
    with engine.begin() as c:
        res = c.execute(text(
            "UPDATE langchain_pg_embedding "
            "SET cmetadata = (cmetadata::jsonb || jsonb_build_object('domain', :d))::json "
            "WHERE cmetadata->>'page_id' = :p"
        ), {"d": domain, "p": page_id})
        return res.rowcount or 0


def _run(limit: int, apply: bool) -> None:
    from sqlalchemy import text

    from app.classifier.llm_classifier import classify_domain_llm
    from app.persistence.database import engine

    status = dict(EMPTY_STATUS)
    status.update({"state": "running", "started_at": time.time(), "applied": apply})
    try:
        with engine.connect() as c:
            rows = c.execute(text(
                "SELECT page_id, title, domain, "
                "left(coalesce((SELECT string_agg(document, ' ') FROM langchain_pg_embedding e "
                "WHERE e.cmetadata->>'page_id' = kb_meta.page_id), ''), 1200) AS sample "
                "FROM kb_meta WHERE title IS NOT NULL ORDER BY last_synced DESC NULLS LAST "
                "LIMIT :lim"
            ), {"lim": limit}).fetchall()

        status["total"] = len(rows)
        _write_status(status)

        changes = []
        for i, r in enumerate(rows, 1):
            page_id, title, current, sample = r[0], r[1] or "", (r[2] or "general"), r[3] or ""
            got = classify_domain_llm(f"{title}\n\n{sample}")
            if got:
                suggested, conf, reason = got
                if suggested != current and conf >= 0.6:
                    changes.append({
                        "page_id": page_id, "title": title[:120],
                        "current": current, "suggested": suggested,
                        "confidence": conf, "reason": reason,
                    })
            status["done"] = i
            status["changed"] = len(changes)
            status["changes"] = changes[-80:]
            if i % 5 == 0 or i == len(rows):
                _write_status(status)

        if apply and changes:
            for ch in changes:
                _apply_change(ch["page_id"], ch["suggested"])
            status["applied_count"] = len(changes)
            logger.info("reclassify applied %d change(s)", len(changes))

        status.update({"state": "done", "finished_at": time.time()})
        _write_status(status)
    except Exception as exc:  # noqa: BLE001
        logger.exception("reclassify failed")
        status.update({"state": "error", "error": str(exc)[:300], "finished_at": time.time()})
        _write_status(status)


def start_reclassify(limit: int = 250, apply: bool = False) -> dict:
    """Kick off a run in the background. Refuses to start a second one."""
    global _thread
    with _LOCK:
        if _thread and _thread.is_alive():
            return {"started": False, "reason": "already running",
                    "status": reclassify_status()}
        _write_status(dict(EMPTY_STATUS))
        _thread = threading.Thread(target=_run, args=(limit, apply), daemon=True)
        _thread.start()
    return {"started": True, "limit": limit, "apply": apply}
