from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import get_current_user
from app.auth.rbac import require_role
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.schemas import ArticleDraftRequest, ArticleRequest, ArticleSearchRequest

logger = logging.getLogger(__name__)

router = APIRouter()

@router.post("/api/articles/search")
def articles_search(req: ArticleSearchRequest, user: str = Depends(get_current_user)) -> dict:
    """Return KB articles for the user to select (design doc §7, Phase 1)."""
    from app.rag.retrieval import retrieve

    try:
        docs = retrieve(req.query, domain=req.domain, k=req.top_k)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"retrieval unavailable: {type(exc).__name__}")
    return {
        "query": req.query,
        "domain": req.domain,
        "articles": [{"title": d["title"], "confidence": d["confidence"],
                      "source_url": d["source_url"], "domain": d["domain"]} for d in docs],
    }


@router.post("/api/articles/sync")
def articles_sync(user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Queue a KB sync and return immediately.

    This used to run the whole sync inside the request. A real sync takes ~90s (the
    scheduled one measured 88s), which is longer than the proxy in front of the app waits,
    so the browser got a 504 and the Knowledge page reported "Sync failed" while the sync
    was in fact still running — and each retry started another concurrent one. The caller
    now watches `/api/sync-status` (`state`, `started_at`) instead of holding a connection.
    """
    import logging
    import threading

    from app.knowledge.ingest import SyncBusy, sync_all, sync_state

    if sync_state().get("state") == "running":
        raise HTTPException(
            status_code=409,
            detail="A knowledge-base sync is already running. Watch the status line.",
        )

    audit("sync", user, detail="kb_sync")
    try:
        from workers.sync_tasks import sync_kb

        task = sync_kb.delay(user)
        return {"queued": True, "task_id": task.id, "runner": "celery"}
    except Exception as exc:  # noqa: BLE001 — broker down: still never block for 90s
        logging.getLogger("knowledge.sync").warning(
            "celery enqueue failed (%s); running the sync in a thread", exc
        )

        def _run() -> None:
            try:
                sync_all(updated_by=user)
            except SyncBusy:
                pass
            except Exception:  # noqa: BLE001 — the run-state row records the failure
                logging.getLogger("knowledge.sync").exception("background sync failed")

        threading.Thread(target=_run, name="kb-sync", daemon=True).start()
        return {"queued": True, "runner": "thread"}


@router.post("/api/articles/draft")
def article_draft(req: ArticleDraftRequest, user: str = Depends(get_current_user),
                  role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """AI writing assist — generate a KB article draft for the given topic/domain."""
    from app.orchestration.orchestrator import answer_chain

    prompt = (
        "You are an internal IT knowledge-base author. Write a concise, practical "
        f"KB article in Confluence style about: {req.topic} (domain: {req.domain}).\n"
        "Structure it with: Overview, Steps (numbered), Verification, and Troubleshooting. "
        "Keep it factual and generic to the domain. Max ~300 words."
    )
    try:
        text = answer_chain().invoke(
            {"context": "(no retrieved documents — draft from domain knowledge)",
             "question": prompt}
        )
        return {"draft": text}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"draft generation failed: {type(exc).__name__}")


@router.post("/api/articles")
def article_create(req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Add a KB article — v0.19.0: writes to Confluence (domain section) when
    the space is configured, then ingests locally. Falls back to local-only
    (page_id kept) if the Confluence write fails."""
    from app.integrations.confluence_write import create_kb_page
    from app.knowledge.ingest import ingest_article

    confluence = create_kb_page(req.title, req.body, req.domain)

    page_id = req.page_id
    source_url = req.source_url
    if confluence.get("ok"):
        page_id = confluence["page_id"]
        source_url = confluence.get("url") or source_url

    payload = req.model_dump()
    payload["page_id"] = page_id
    payload["source_url"] = source_url
    status = ingest_article(payload)
    return {
        "status": status,
        "page_id": page_id,
        "confluence": confluence,
    }


@router.put("/api/articles/{page_id}")
def article_update(page_id: str, req: ArticleRequest, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Update a KB article (change-detected → re-embed)."""
    from app.knowledge.ingest import ingest_article

    return {"status": ingest_article({**req.model_dump(), "page_id": page_id, "updated_by": user}), "page_id": page_id}


@router.get("/api/articles-domains")
def article_domains(user: str = Depends(get_current_user)) -> dict:
    """Domain browse cards for the Knowledge tab (merges classifier_domains with kb_meta counts, RBAC-filtered)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role
    from app.persistence.models import ClassifierDomain

    with SessionLocal() as s:
        # Load all active classifier domains metadata
        db_domains = s.query(ClassifierDomain).filter(ClassifierDomain.is_active == True).order_by(ClassifierDomain.id.asc()).all()
        meta_dict = {
            d.domain_key: {
                "display_name": d.display_name,
                "description": d.description,
                "icon": d.icon or "BookOpen",
                "color": d.color or "blue",
                "custom_icon": d.custom_icon,
            }
            for d in db_domains
        }

        # Page counts from kb_meta
        rows = s.execute(_text(
            "SELECT domain, count(*) AS pages, max(last_synced) AS last_synced "
            "FROM kb_meta GROUP BY domain ORDER BY pages DESC"
        )).mappings().all()

    counts = {
        (r["domain"] or "general"): {
            "pages": r["pages"],
            "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None,
        }
        for r in rows
    }

    allowed = allowed_domains(get_role(user))
    all_keys = list(meta_dict.keys())
    for k in counts:
        if k not in all_keys:
            all_keys.append(k)

    domains = []
    for k in all_keys:
        if allowed is not None and k not in allowed:
            continue
        c = counts.get(k, {"pages": 0, "last_synced": None})
        m = meta_dict.get(k, {})
        domains.append({
            "domain": k,
            "display_name": m.get("display_name") or k.capitalize(),
            "description": m.get("description") or f"Guides and resources for {k}.",
            "icon": m.get("icon") or "BookOpen",
            "color": m.get("color") or "blue",
            "custom_icon": m.get("custom_icon"),
            "pages": c["pages"],
            "last_synced": c["last_synced"],
        })

    return {"domains": domains}


def classify_source(source_url: str, page_id: str) -> str:
    """Which provider an article came from — decided from the row, not a fixed list."""
    url = (source_url or "").lower()
    if "atlassian.net" in url or "confluence" in url:
        return "confluence"
    pid = str(page_id or "")
    if pid.startswith("manual-"):
        return "manual"
    if pid.isdigit():
        return "confluence"  # legacy Confluence pages stored with a bare numeric id
    return "unknown"


@router.get("/api/articles-sources")
def article_sources(user: str = Depends(get_current_user)) -> dict:
    """Providers that actually contributed articles, with counts.

    The Knowledge page used to print the length of a hardcoded provider array, so it said
    "2 sources" on an installation where only Confluence was configured. Counting rows makes
    the number a fact.
    """
    from sqlalchemy import text


    labels = {"confluence": "Confluence", "manual": "Manual", "unknown": "Internal"}
    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT COALESCE(source_url, ''), COALESCE(page_id, '') FROM kb_meta"
        )).fetchall()
    counts: dict[str, int] = {}
    for url, pid in rows:
        key = classify_source(url, pid)
        counts[key] = counts.get(key, 0) + 1
    return {"sources": [
        {"key": k, "label": labels[k], "count": counts[k]}
        for k in sorted(counts, key=lambda c: -counts[c])
    ]}


@router.get("/api/articles-recent")
def articles_recent(limit: int = 8, user: str = Depends(get_current_user)) -> dict:
    """Recently updated KB pages (Knowledge tab section B)."""
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role

    limit = max(1, min(limit, 25))
    with SessionLocal() as s:
        rows = s.execute(_text(
            "SELECT title, domain, source_url, updated_by, last_synced "
            "FROM kb_meta WHERE title IS NOT NULL "
            "ORDER BY last_synced DESC LIMIT :lim"
        ), {"lim": limit}).mappings().all()
    allowed = allowed_domains(get_role(user))
    articles = [
        {"title": r["title"], "domain": r["domain"] or "general", "source_url": r["source_url"],
         "updated_by": r["updated_by"], "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows if allowed is None or (r["domain"] or "general") in allowed
    ]
    return {"articles": articles}


@router.get("/api/articles-list")
def articles_list(domain: str | None = None, q: str | None = None, limit: int = 50,
                  offset: int = 0, sort: str = "last_synced", order: str = "desc",
                  provider: str | None = None, q_field: str = "all",
                  user: str = Depends(get_current_user)) -> dict:
    """Paged KB list for the Manage table (no vector calls; kb_meta only).

    v1.6.47 — paging, sorting and the provider filter are all SERVER-side. The
    table previously fetched a fixed 50 rows and did everything in the browser, so
    sorting or filtering only ever reordered that page while looking like it had
    searched the whole knowledge base — the same class of wrong answer as the
    "50 articles" total. `provider` matches on the source host, which is the same
    signal the Source column badge uses.
    """
    from sqlalchemy import text as _text

    from app.auth.rbac import allowed_domains, get_role

    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    allowed = allowed_domains(get_role(user))
    if allowed is not None:
        if domain and domain not in allowed:
            return {"articles": [], "total": 0, "returned": 0, "offset": offset}
        domains = sorted(allowed)
    else:
        domains = None

    # Sortable columns — an allowlist, never interpolated from user input.
    sort_col = {
        "last_synced": "last_synced",
        "title": "title",
        "domain": "coalesce(domain,'general')",
    }.get((sort or "").strip(), "last_synced")
    direction = "ASC" if str(order).lower() == "asc" else "DESC"

    # provider -> source_url pattern (mirrors the frontend badge resolution)
    provider_like = {
        "confluence": "%atlassian.net%",
    }.get((provider or "").strip().lower())

    where = ["1=1"]
    params: dict = {"lim": limit, "off": offset}
    if domain:
        where.append("domain = :dom")
        params["dom"] = domain
    if q:
        if q_field == "title":
            where.append("coalesce(title,'') ILIKE :q")
        elif q_field == "body":
            where.append("coalesce(body,'') ILIKE :q")
        else:
            where.append("(coalesce(title,'') ILIKE :q OR coalesce(body,'') ILIKE :q)")
        params["q"] = f"%{q}%"
    if domains is not None:
        where.append("coalesce(domain,'general') = ANY(:doms)")
        params["doms"] = domains
    if provider_like:
        where.append("coalesce(source_url,'') ILIKE :prov")
        params["prov"] = provider_like

    clause = " AND ".join(where)
    sql = ("SELECT page_id, title, domain, space_key, source_url, updated_by, last_synced "
           f"FROM kb_meta WHERE {clause} "
           f"ORDER BY {sort_col} {direction} NULLS LAST, page_id ASC "
           "LIMIT :lim OFFSET :off")
    # v1.6.46 — the count uses the same WHERE clause so the header reports the real
    # size of what this user may see, not the number of rows returned by LIMIT.
    count_sql = f"SELECT count(*) FROM kb_meta WHERE {clause}"
    count_params = {k: v for k, v in params.items() if k not in ("lim", "off")}
    with SessionLocal() as s:
        rows = s.execute(_text(sql), params).mappings().all()
        total = s.execute(_text(count_sql), count_params).scalar() or 0
    articles = [
        {"page_id": r["page_id"], "title": r["title"], "domain": r["domain"] or "general",
         "space_key": r["space_key"] or _space_from_url(r["source_url"]),
         "source_url": r["source_url"], "updated_by": r["updated_by"],
         "last_synced": r["last_synced"].isoformat() if r["last_synced"] else None}
        for r in rows
    ]
    return {"articles": articles, "total": int(total), "returned": len(articles),
            "offset": offset, "limit": limit}


@router.get("/api/sync-status")
def sync_status(user: str = Depends(get_current_user)) -> dict:
    """Last sync snapshot + next beat ETA (Knowledge tab header/health strip)."""
    import json as _json

    from sqlalchemy import text as _text

    from app.persistence.models import RuntimeKv

    with SessionLocal() as s:
        kv = s.get(RuntimeKv, "kb_last_sync")
        pages = s.execute(_text("SELECT count(*) FROM kb_meta")).scalar() or 0
    snap = _json.loads(kv.value) if kv and kv.value else None
    from app.knowledge.ingest import sync_state

    run = sync_state()
    return {
        "pages": pages,
        "last_run": snap,
        "state": run.get("state", "idle"),
        "started_at": run.get("started_at"),
        "started_by": run.get("by"),
        "run_error": run.get("error"),
        "healthy": bool(snap),
        "beat_interval_minutes": 30,  # workers/celery_app.py beat schedule
    }


@router.delete("/api/articles/{page_id}")
def article_delete(page_id: str, user: str = Depends(get_current_user),
                   role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Remove a KB article (vectors + sync meta)."""
    from app.knowledge.ingest import _delete_vectors
    from app.persistence.models import KbMeta

    _delete_vectors(page_id)
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id)
        if meta:
            s.delete(meta)
            s.commit()
    try:
        from app.rag.bm25_index import BM25IndexManager
        BM25IndexManager.get_instance().invalidate()
    except Exception as exc:
        logging.getLogger("knowledge").debug("BM25 index invalidation ignored: %s", exc)
    return {"status": "deleted", "page_id": page_id}


# --------------------------------------------------------------------------
# v1.6.47 — bulk operations for the Manage table
#   Moving 229 articles one row at a time is not a workflow. Both endpoints are
#   bounded and report per-id results, so a single bad id does not silently
#   abandon the rest of the batch.
# --------------------------------------------------------------------------


@router.post("/api/knowledge/articles/bulk-move")
def articles_bulk_move(req: dict,
                       user: str = Depends(get_current_user),
                       role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Reassign many articles to one domain (kb_meta + stored chunk metadata)."""
    from app.knowledge.reclassify import _apply_change

    page_ids = [str(p) for p in (req.get("page_ids") or []) if p][:500]
    domain = str(req.get("domain") or "").strip().lower()
    if not page_ids:
        raise HTTPException(status_code=400, detail="page_ids is required")
    if not domain:
        raise HTTPException(status_code=400, detail="domain is required")

    moved, chunks, failed = 0, 0, []
    for pid in page_ids:
        try:
            chunks += _apply_change(pid, domain)
            moved += 1
        except Exception as exc:
            failed.append({"page_id": pid, "error": str(exc)[:120]})

    try:
        from app.rag.bm25_index import BM25IndexManager

        BM25IndexManager.get_instance().invalidate()
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"moved": moved, "domain": domain, "chunks_touched": chunks,
            "failed": failed}


@router.post("/api/knowledge/articles/bulk-delete")
def articles_bulk_delete(req: dict,
                         user: str = Depends(get_current_user),
                         role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Remove many KB articles (vectors + sync meta)."""
    from app.knowledge.ingest import _delete_vectors
    from app.persistence.models import KbMeta

    page_ids = [str(p) for p in (req.get("page_ids") or []) if p][:500]
    if not page_ids:
        raise HTTPException(status_code=400, detail="page_ids is required")

    deleted, failed = 0, []
    for pid in page_ids:
        try:
            _delete_vectors(pid)
            with SessionLocal() as s:
                row = s.get(KbMeta, pid)
                if row:
                    s.delete(row)
                    s.commit()
            deleted += 1
        except Exception as exc:
            failed.append({"page_id": pid, "error": str(exc)[:120]})

    try:
        from app.rag.bm25_index import BM25IndexManager

        BM25IndexManager.get_instance().invalidate()
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"deleted": deleted, "failed": failed}


# --------------------------------------------------------------------------
# P3c — KB re-classification audit
#   /api/knowledge/reclassify          start a run (background thread)
#   /api/knowledge/reclassify/status   progress + the proposed diff
# The LLM classifies every article; the admin reviews the diff before applying.
# --------------------------------------------------------------------------


@router.post("/api/knowledge/reclassify")
def reclassify_start(req: dict | None = None,
                     user: str = Depends(get_current_user),
                     role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Start re-classifying the KB with the LLM. `{"apply": true}` also applies it."""
    from app.knowledge.reclassify import start_reclassify

    body = req or {}
    try:
        limit = max(1, min(1000, int(body.get("limit") or 250)))
    except (TypeError, ValueError):
        limit = 250
    return start_reclassify(limit=limit, apply=bool(body.get("apply")))


@router.get("/api/knowledge/reclassify/status")
def reclassify_progress(user: str = Depends(get_current_user),
                        role: str = Depends(require_role("admin", "knowledge"))) -> dict:
    """Poll progress; `changes` is the proposed (or applied) diff."""
    from app.knowledge.reclassify import reclassify_status

    return reclassify_status()


# --------------------------------------------------------------------------
# Settings (Phase 10.1)
#   /api/settings            user prefs (GET/PUT)
#   /api/admin/settings      RAG-tuning overrides (admin only, GET/PUT/DELETE)
#   /api/integrations/status integration status grid (read-only; never secrets)
# --------------------------------------------------------------------------

