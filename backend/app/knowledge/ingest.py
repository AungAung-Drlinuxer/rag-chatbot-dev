"""Ingest (Phase 7) — chunk → embed → upsert into pgvector, idempotent + change-detection.

Change-detection: an md5(title+body) is stored in `kb_meta`; a repeat sync with the same
hash SKIPS the page. A changed page is re-chunked/re-embedded (old vectors pruned first).
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime

from sqlalchemy import text

from app.knowledge.chunker import chunk_text
from app.config import SETTINGS
from app.persistence.database import SessionLocal, engine
from app.knowledge.loaders import load_all
from app.persistence.models import KbMeta
from app.rag.retrieval import add_texts

logger = logging.getLogger("ingest")


# Bump when chunking/embedding format changes so all pages re-ingest once.
_CHUNK_FORMAT_VERSION = "v4-domain-classified-v2"  # v0.10.0: title+header prefixed chunks


def _content_hash(title: str, body: str) -> str:
    return hashlib.md5(
        f"{_CHUNK_FORMAT_VERSION}\x00{title}\x00{body}".encode()
    ).hexdigest()


def _delete_vectors(page_id: str) -> None:
    """Prune cached vectors for a page (LangChain PGVector table)."""
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM langchain_pg_embedding WHERE cmetadata->>'page_id' = :p"),
            {"p": page_id},
        )


def _upsert_meta(page_id: str, chash: str, domain: str, title: str, source_url: str,
                 body: str | None = None, updated_by: str | None = None) -> None:
    with SessionLocal() as s:
        meta = s.get(KbMeta, page_id) or KbMeta(page_id=page_id)
        meta.content_hash = chash
        meta.domain = domain
        meta.title = title
        meta.source_url = source_url
        if body is not None:
            meta.body = body
        if updated_by:
            meta.updated_by = updated_by
        meta.last_synced = datetime.now(UTC)
        s.add(meta)
        s.commit()


def _effective_domain(art: dict) -> str:
    """Resolve a real pipeline domain for the article.

    Sources that set a meaningful domain keep it; space-key placeholders
    (e.g. Confluence 'ihkb') are re-classified from title+body keywords so
    the retriever's domain filter can actually match (v0.10.1).
    Dynamically loads active domains from the database rules instead of static set.
    """
    from app.classifier.engine import classify_domain, get_active_keyword_rules

    domain = (art.get("domain") or "").strip().lower()
    try:
        active_domains = set(get_active_keyword_rules().keys())
    except Exception:
        active_domains = set()
    active_domains.add("general")

    if domain in active_domains:
        return domain

    # Title signal first (more reliable than body keywords) — v0.10.8.
    title = art.get("title", "") or ""

    # P3 — ask the LLM (it understands topic, not just substrings) using the title
    # plus a body sample, and keep the keyword cascade underneath. Ingest is async
    # (Celery) so the extra call costs no user-visible latency, and any LLM failure
    # falls through to the keyword path below.
    try:
        from app.classifier.llm_classifier import classify_domain_llm

        sample = f"{title}\n\n{(art.get('body') or '')[:1200]}"
        got = classify_domain_llm(sample)
        if got:
            d, conf, reason = got
            if conf >= 0.6:
                logger.info("ingest classify: %r -> %s (%.2f, %s)", title[:50], d, conf, reason)
                return d
    except Exception as exc:  # noqa: BLE001
        logger.debug("ingest LLM classify unavailable (%s) — keyword path", exc)

    d, conf = classify_domain(title)
    if conf >= 0.75:
        return d
    text = f"{title} {(art.get('body') or '')[:1500]}".lower()
    d, conf = classify_domain(text)
    if conf >= 0.7:
        return d
    return "general"


def ingest_article(art: dict) -> str:
    """Ingest one article → 'inserted' | 'updated' | 'skipped'."""
    chash = _content_hash(art["title"], art["body"])
    with SessionLocal() as s:
        existing = s.get(KbMeta, art["page_id"])

    # The unchanged check comes FIRST: domain resolution can call the classifier LLM, and
    # doing it before this check meant every 30-minute sync paid one model call per page
    # (94 calls, minutes of CPU) only to write nothing.
    if existing and existing.content_hash == chash:
        return "skipped"

    art = {**art, "domain": _effective_domain(art)}

    chunks = chunk_text(
        art["body"],
        chunk_tokens=SETTINGS.chunk_tokens,
        overlap=SETTINGS.chunk_overlap,
        context_prefix=art["title"],  # v0.10.0: every chunk carries title+header context
    )
    texts = chunks
    # v1.6.34 — adapters may attach source-specific metadata (ClickUp status /
    # priority / assignees, Notion last-edited). Those keys must reach the vector
    # store's `cmetadata` or they cannot be filtered on later. Values are coerced
    # to short strings and the core keys below always win, so an adapter can never
    # clobber page_id / domain / source_url.
    extra_meta: dict[str, str] = {}
    for k, v in (art.get("meta") or {}).items():
        if v is None or isinstance(v, (dict, list)):
            continue
        key = str(k).strip()[:40]
        if not key:
            continue
        extra_meta[key] = str(v)[:200]

    metadatas = [{
        "page_id": art["page_id"],
        "page_title": art["title"],
        "domain": art["domain"],
        "source_url": art["source_url"],
        "content_hash": chash,
        "chunk_index": str(i),
        **extra_meta,
    } for i in range(len(chunks))]

    if existing:
        _delete_vectors(art["page_id"])

    if texts:
        add_texts(texts, metadatas=metadatas)
    _upsert_meta(art["page_id"], chash, art["domain"], art["title"], art.get("source_url") or "",
                 body=art.get("body"), updated_by=art.get("updated_by"))

    try:
        from app.rag.bm25_index import BM25IndexManager
        BM25IndexManager.get_instance().invalidate()
    except Exception as exc:
        logger.debug("BM25 index invalidation ignored: %s", exc)

    return "updated" if existing else "inserted"


def register_domains(domain_keys: list[str]) -> int:
    """Make every domain that actually has articles routable.

    Domains & Routing reads `classifier_domains` only, so on a fresh install it was an empty
    page even though the KB had content in six domains — there was no way to create the rows
    without typing each one by hand. Registering what the sync saw keeps the page truthful
    and leaves the description/keywords for the admin to fill in.
    """
    from app.persistence.models import ClassifierDomain

    created = 0
    keys = sorted({(k or "").strip().lower() for k in domain_keys if (k or "").strip()})
    if not keys:
        return 0
    with SessionLocal() as s:
        existing = {d.domain_key for d in s.query(ClassifierDomain).all()}
        for key in keys:
            if key in existing:
                continue
            s.add(ClassifierDomain(
                domain_key=key,
                display_name=key.replace("_", " ").replace("-", " ").title(),
                description=None,
                keywords=[],
                is_active=True,
            ))
            created += 1
        if created:
            s.commit()
    return created


def sync_all(updated_by: str | None = None) -> dict:
    """Sync every configured KB source. Returns counts (+ persists a health snapshot)."""
    articles = load_all()
    stats = {"pages": len(articles), "inserted": 0, "updated": 0, "skipped": 0}
    try:
        from app.persistence.database import init_db
        init_db()  # ensure kb_meta table exists
    except Exception as exc:
        logger.warning(f"init_db during sync skipped ({type(exc).__name__}): {exc}")
    for art in articles:
        status = ingest_article({**art, "updated_by": updated_by or art.get("updated_by")})
        stats[status] += 1
    try:
        # Register what actually landed in the KB, not the raw loader values: a loader may
        # emit a space key ("ihkb") that the classifier later rewrites, and registering that
        # left a phantom domain on the routing page.
        with SessionLocal() as s:
            landed = [r[0] for r in s.execute(text(
                "SELECT DISTINCT domain FROM kb_meta WHERE domain IS NOT NULL")).fetchall()]
        stats["domains_registered"] = register_domains(landed)
    except Exception as exc:  # a domain row must never fail the ingest
        logger.warning("domain registration skipped (%s): %s", type(exc).__name__, exc)

    logger.info("sync done %s", stats)

    # Sync-health snapshot for the Knowledge tab strip (best-effort).
    try:
        from datetime import UTC
        from datetime import datetime as _dt

        from app.persistence.models import RuntimeKv
        with SessionLocal() as s:
            kv = s.get(RuntimeKv, "kb_last_sync") or RuntimeKv(key="kb_last_sync")
            kv.value = json.dumps({"at": _dt.now(UTC).isoformat(), **stats})
            s.add(kv)
            s.commit()
    except Exception as exc:
        logger.warning(f"sync-health snapshot skipped ({type(exc).__name__}): {exc}")

    return stats
