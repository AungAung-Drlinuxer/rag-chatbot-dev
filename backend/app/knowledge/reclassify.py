"""KB re-classification audit (P3c).

WHAT
----
Runs the LLM classifier over every article in `kb_meta` and reports the articles
whose domain should change, then optionally applies them.

WHY IT RUNS ON CELERY
---------------------
229 articles x ~1.3s per LLM call is ~5 minutes — far past any gateway timeout, so this
cannot be a synchronous request. It used to run in a `threading.Thread` inside the web
worker, which meant a deploy, an OOM kill or a worker recycle left the row frozen at
"running, 70/104" forever: the thread was gone but the status still claimed the job was
alive, so the Knowledge page polled a percentage that could never move.

Now the job is a Celery task (restart-survivable, visible across replicas) and every
status write carries a heartbeat. `reclassify_status()` reports a run whose heartbeat
stopped as `interrupted` instead of `running`, so the UI can offer "start again" rather
than spinning at 67% indefinitely.

SPEED
-----
Classification is IO-bound (one HTTP call per article), so a small thread pool runs four
calls at once: ~4x faster with no extra load on the LLM provider's rate limit because the
work is the same, just overlapped. Progress is written as each article completes.

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
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger("knowledge.reclassify")

_STATUS_KEY = "kb_reclassify_status"
_LOCK = threading.Lock()
_thread: threading.Thread | None = None

# A live run writes status at least every few seconds. Five minutes without a heartbeat
# means the process died, not that the LLM is slow (each call has its own timeout).
STALE_AFTER_S = 300
WORKERS = 4

EMPTY_STATUS = {
    "state": "idle", "total": 0, "done": 0, "changed": 0,
    "started_at": None, "finished_at": None, "heartbeat_at": None,
    "applied": False, "error": None, "changes": [],
}


def _write_status(payload: dict) -> None:
    from app.persistence.database import SessionLocal
    from app.persistence.models import RuntimeKv

    payload = {**payload, "heartbeat_at": time.time()}
    with SessionLocal() as s:
        row = s.get(RuntimeKv, _STATUS_KEY)
        if row is None:
            s.add(RuntimeKv(key=_STATUS_KEY, value=json.dumps(payload)))
        else:
            row.value = json.dumps(payload)
        s.commit()


def reclassify_status() -> dict:
    """Current run, with a dead run reported as `interrupted` rather than `running`."""
    from app.persistence.database import SessionLocal
    from app.persistence.models import RuntimeKv

    try:
        with SessionLocal() as s:
            row = s.get(RuntimeKv, _STATUS_KEY)
            if row and row.value:
                data = json.loads(row.value) if isinstance(row.value, str) else row.value
                out = {**EMPTY_STATUS, **data}
                if out.get("state") == "running":
                    beat = out.get("heartbeat_at") or out.get("started_at") or 0
                    if beat and time.time() - beat > STALE_AFTER_S:
                        done, total = out.get("done", 0), out.get("total", 0)
                        out.update({
                            "state": "interrupted",
                            "error": (f"The run stopped responding at {done}/{total} "
                                      "(the backend restarted). Nothing was applied — "
                                      "start it again."),
                        })
                return out
    except Exception as exc:
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


def _classify_one(row) -> dict | None:
    from app.classifier.llm_classifier import classify_domain_llm

    page_id, title, current, sample = row[0], row[1] or "", (row[2] or "general"), row[3] or ""
    got = classify_domain_llm(f"{title}\n\n{sample}")
    if not got:
        return None
    suggested, conf, reason = got
    if suggested == current or conf < 0.6:
        return None
    return {
        "page_id": page_id, "title": title[:120],
        "current": current, "suggested": suggested,
        "confidence": conf, "reason": reason,
    }


def run_reclassify(limit: int = 250, apply: bool = False) -> dict:
    """Classify up to `limit` articles, optionally applying the changes. Blocking."""
    from sqlalchemy import text

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

        changes: list[dict] = []
        done = 0
        guard = threading.Lock()

        with ThreadPoolExecutor(max_workers=WORKERS, thread_name_prefix="reclass") as pool:
            futures = {pool.submit(_classify_one, r): r[0] for r in rows}
            for fut in as_completed(futures):
                try:
                    change = fut.result()
                except Exception as exc:  # one bad article must not kill the run
                    logger.warning("reclassify: classify failed for %s: %s", futures[fut], exc)
                    change = None
                with guard:
                    done += 1
                    if change:
                        changes.append(change)
                    status["done"] = done
                    status["changed"] = len(changes)
                    status["changes"] = changes[-80:]
                    # Write every article: the heartbeat is what lets the UI tell a slow
                    # run from a dead one, and 1 row update per article is cheap.
                    _write_status(status)

        if apply and changes:
            for ch in changes:
                _apply_change(ch["page_id"], ch["suggested"])
            status["applied_count"] = len(changes)
            logger.info("reclassify applied %d change(s)", len(changes))

        status.update({"state": "done", "finished_at": time.time()})
        _write_status(status)
        return status
    except Exception as exc:
        logger.exception("reclassify failed")
        status.update({"state": "error", "error": str(exc)[:300], "finished_at": time.time()})
        _write_status(status)
        return status


def start_reclassify(limit: int = 250, apply: bool = False) -> dict:
    """Kick off a run: Celery when the broker answers, a thread when it does not.

    A single-replica dev box often has no broker; falling back keeps the feature usable
    there without pretending it will survive a restart.
    """
    global _thread
    current = reclassify_status()
    if current.get("state") in ("running", "queued"):
        return {"started": False, "reason": "already running", "status": current}

    queued = dict(EMPTY_STATUS)
    queued.update({
        "state": "queued", "total": 0, "applied": apply,
        "started_at": time.time(), "heartbeat_at": time.time(),
    })
    _write_status(queued)

    try:
        from workers.reclassify_task import reclassify_task

        task = reclassify_task.delay(limit, apply)
        _write_status({**queued, "task_id": task.id})
        return {"started": True, "limit": limit, "apply": apply, "runner": "celery",
                "task_id": task.id}
    except Exception as exc:
        logger.warning("celery enqueue failed (%s) — running in-process", exc)

    with _LOCK:
        if _thread and _thread.is_alive():
            return {"started": False, "reason": "already running",
                    "status": reclassify_status()}
        _thread = threading.Thread(target=run_reclassify, args=(limit, apply), daemon=True)
        _thread.start()
    return {"started": True, "limit": limit, "apply": apply, "runner": "thread"}
