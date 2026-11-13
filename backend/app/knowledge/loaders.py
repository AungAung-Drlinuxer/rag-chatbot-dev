"""Multi-source KB loaders (Phase 7) — Confluence + file shares / runbooks (txt/md/pdf/docx).

Returns article dicts: {page_id, title, domain, source_url, body}.
"""
from __future__ import annotations

import logging
import os

from app.config import SETTINGS
from app.integrations.confluence import fetch_space as _fetch_confluence
from app.integrations.confluence import space_keys as _confluence_space_keys

logger = logging.getLogger("knowledge.loaders")

_TEXTLIKE = (".md", ".txt", ".pdf", ".docx")


def load_confluence() -> list[dict]:
    """Every configured Confluence site × every space it declares.

    A failure on one site must not empty the KB of the others, so each site/space pair is
    isolated. Page ids are prefixed with the connection id for non-default sites: Atlassian
    page ids are per-instance, so the same number can exist on two sites and would otherwise
    overwrite the other's row and vectors.
    """
    from app.integrations.connections import effective_connections

    articles: list[dict] = []
    conns = effective_connections("confluence")
    if not conns:
        # Nothing configured at all — keep the legacy path's behaviour (no articles).
        return articles

    for conn in conns:
        spaces = conn.get("spaces") or []
        if isinstance(spaces, str):
            spaces = [x.strip() for x in spaces.split(",") if x.strip()]
        for space in spaces:
            try:
                fetched = _fetch_confluence(space, conn)
            except Exception as exc:  # one site's token/URL must not stop the rest
                logger.warning(
                    "confluence %s / %s failed: %s", conn.get("label"), space, exc
                )
                continue
            for a in fetched:
                a.setdefault("domain", space.lower())
                a["space_key"] = space
                a["connection_id"] = conn.get("id")
                a["site"] = a.get("site") or conn.get("site") or ""
                if conn.get("id"):
                    a["page_id"] = f"c{conn['id']}:{a['page_id']}"
                articles.append(a)
    return articles


def _read_text(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".md", ".txt"):
        with open(path, encoding="utf-8", errors="ignore") as f:
            return f.read()
    if ext == ".pdf":
        try:
            import pymupdf  # optional — install `pymupdf` for PDFs
            return "\n".join(p.get_text() for p in pymupdf.open(path))
        except Exception:
            return ""
    if ext == ".docx":
        try:
            import docx  # optional — install `python-docx`
            return "\n".join(p.text for p in docx.Document(path).paragraphs)
        except Exception:
            return ""
    return ""


def load_fileshare(base_dir: str | None = None) -> list[dict]:
    base = base_dir or SETTINGS.fileshare_dir
    if not os.path.isdir(base):
        return []
    articles: list[dict] = []
    for root, _, files in os.walk(base):
        for fname in sorted(files):
            if not fname.lower().endswith(_TEXTLIKE):
                continue
            full = os.path.join(root, fname)
            body = _read_text(full)
            if not body:
                continue
            stem = os.path.splitext(fname)[0]
            articles.append({
                "page_id": f"fs-{stem}",
                "title": fname,
                "domain": SETTINGS.fileshare_domain,
                "source_url": f"{SETTINGS.fileshare_domain}://{full.replace(os.sep, '/')}",
                "body": body,
            })
    return articles


def load_all() -> list[dict]:
    """Aggregate KB sources: Confluence, plus the mounted file share when configured.

    This deployment has exactly one document connector. The previous version stitched
    together OpenProject/XWiki/Notion/ClickUp/Anytype/Hashnode behind individual
    try/excepts — six integrations kept alive for nobody, each one a dependency that could
    fail an ingest. They are gone; a new connector belongs here only when the product
    actually runs it.
    """
    articles: list[dict] = []
    articles.extend(load_confluence())

    if SETTINGS.fileshare_dir:
        try:
            articles.extend(load_fileshare())
        except Exception as exc:  # pragma: no cover — never break the whole ingest
            logger.warning("fileshare load skipped: %s", exc)

    return articles
