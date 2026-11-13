"""Confluence article puller — REST search with the credentials an admin saved in the UI.

Configuration precedence: `system_settings["confluence"]` (what Settings → Integrations
writes) wins, environment variables are the fallback for local/dev runs. The token is
write-only in the API, so this module is the only place that reads it back.

Scope: only pages carrying the labels `approved` AND `chatbot-safe` are ingested, and pages
labelled `restricted` / `internal-only` / `on-call` are excluded even if they carry both.
Set `CONFLUENCE_SKIP_LABEL_FILTER=1` for a first run against a test space.
"""
from __future__ import annotations

import time

from app.config import SETTINGS

_CFG: dict | None = None
_CFG_AT: float = 0.0
_CFG_TTL = 30.0


def _db_cfg() -> dict:
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        row = s.execute(text("SELECT value FROM system_settings WHERE key = 'confluence'")).first()
    val = row[0] if row else {}
    if isinstance(val, str):
        import json

        val = json.loads(val)
    return val or {}


def confluence_cfg() -> dict:
    """Confluence connection settings: the saved row wins outright, env only if none exists.

    Per-field fallback (DB token + env email) is how a saved token ended up paired with
    `CONFLUENCE_EMAIL` — a different Atlassian account — so every request returned 403 and the
    sync imported nothing while the panel looked configured. When an operator has saved this
    integration, the row is the complete configuration; an absent field stays absent and the
    caller reports it, instead of silently borrowing a value from another account.
    """
    global _CFG, _CFG_AT
    now = time.time()
    if _CFG is not None and (now - _CFG_AT) < _CFG_TTL:
        return _CFG
    out = {
        "base_url": SETTINGS.confluence_base_url,
        "email": SETTINGS.confluence_email,
        "api_token": SETTINGS.confluence_token,
        "cloud_id": SETTINGS.confluence_cloud_id,
        "space_keys": SETTINGS.confluence_space_keys,
    }
    try:
        val = _db_cfg()
    except Exception:  # DB not ready yet — env fallback keeps dev runs working
        val = {}
    if val:
        out = {
            "base_url": str(val.get("base_url") or ""),
            "email": str(val.get("email") or ""),
            "api_token": str(val.get("api_token") or val.get("token") or ""),
            "cloud_id": str(val.get("cloud_id") or ""),
            "space_keys": str(val.get("space_keys") or ""),
        }
    _CFG, _CFG_AT = out, now
    return out


def reload_confluence_cfg() -> None:
    """Drop the cache so the next sync picks up what was just saved."""
    global _CFG, _CFG_AT
    _CFG, _CFG_AT = None, 0.0


def space_keys() -> list[str]:
    """Space keys to sync — comma separated in the UI field, e.g. `HELP, IT, ENG`."""
    raw = str(confluence_cfg().get("space_keys") or "")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _fetch_confluence_rest(space_key: str) -> list[dict]:
    """CQL-filtered Confluence REST fetcher using email + API-token Basic auth.

    Safety: only pulls pages tagged 'approved' + 'chatbot-safe' (excludes restricted/internal-only/on-call).
    Service-account permissions still enforce the real access boundary; CQL is an extra layer.
    """
    import base64

    import httpx

    # Two paths supported:
    # A) Atlassian Cloud unified API gateway (preferred for OAuth/Bearer tokens):
    #    GET https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/search
    # B) Direct tenant URL with Basic auth (legacy / non-Cloud):
    #    GET https://{tenant}/wiki/rest/api/content/search
    cfg = confluence_cfg()
    cloud_id = (cfg.get("cloud_id") or "").strip()
    token = (cfg.get("api_token") or "").strip()
    if not token:
        if (cfg.get("base_url") or "").strip():
            raise ValueError(
                "Confluence is half configured: the base URL is saved but there is no API "
                "token. Open Settings → Integrations → Confluence and save the token."
            )
        return []
    if cloud_id:
        # Bearer token + unified gateway (works for both OAuth and PAT in modern Atlassian Cloud)
        api_root = f"https://api.atlassian.com/ex/confluence/{cloud_id}/wiki"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    else:
        base_url = str(cfg.get("base_url") or "").rstrip("/")
        email = str(cfg.get("email") or "").strip()
        if not base_url:
            return []
        if not email:
            # Silently returning [] here is what made "configured" look like "0 pages".
            raise ValueError(
                "Confluence is half configured: the base URL and token are saved but no account "
                "email, and Atlassian requires the email + token of the same account. Open "
                "Settings → Integrations → Confluence and add the account email."
            )
        auth = base64.b64encode(f"{email}:{token}".encode()).decode()
        api_root = base_url
        headers = {"Authorization": f"Basic {auth}", "Accept": "application/json"}

    # CQL filter per design guide. By default require chatbot-safe label.
    # Set CONFLUENCE_SKIP_LABEL_FILTER=1 to ingest all pages (debug / first-run).
    import os
    if os.environ.get("CONFLUENCE_SKIP_LABEL_FILTER") == "1":
        cql = f'space = "{space_key}" AND type = page'
    else:
        cql = (
            f'space = "{space_key}" '
            'AND type = page '
            'AND label = "approved" '
            'AND label = "chatbot-safe" '
            'AND label != "restricted" '
            'AND label != "internal-only" '
            'AND label != "on-call"'
        )

    docs: list[dict] = []
    with httpx.Client(timeout=30, headers=headers) as client:
        # Paginate via _links.next (v0.16.0) — default limit 100 misses larger spaces.
        api_path = "/rest/api/content/search"
        params: dict | None = {"cql": cql, "limit": 100,
                               "expand": "body.storage,version,metadata.labels"}
        url = api_root + api_path
        seen_urls: set[str] = set()
        while True:
            # The first request carries the CQL; every follow-up uses `_links.next` verbatim.
            # Passing `params` again re-sent cql/limit on top of the cursor, so Confluence kept
            # returning the first page and this loop never ended (a sync that ran forever and
            # imported nothing).
            resp = client.get(url, params=params)
            params = None
            resp.raise_for_status()
            payload = resp.json()
            for page in payload.get("results", []):
                body_html = page.get("body", {}).get("storage", {}).get("value", "")
                body_text = _html_to_text(body_html)
                page_id = page.get("id", "")
                webui = page.get("_links", {}).get("webui", "")
                docs.append({
                    "page_id": page_id,
                    "title": page.get("title", "Untitled"),
                    "domain": space_key.lower(),
                    # The space a page came from, independent of the pipeline domain it
                    # later gets classified into (the two diverge when the classifier
                    # re-assigns a page).
                    "source_url": (
                        str(cfg.get("base_url") or "").rstrip("/") + "/" + webui.lstrip("/")
                        if webui else f"{api_root}/spaces/{space_key}/pages/{page_id}"
                    ),
                    "space_key": space_key,
                    "body": body_text,
                })
            next_link = payload.get("_links", {}).get("next")
            if not next_link:
                break
            if next_link.startswith("http"):
                url = next_link
            else:
                url = api_root + (next_link if next_link.startswith("/") else "/" + next_link)
            if url in seen_urls:  # a cursor that does not advance would loop forever
                break
            seen_urls.add(url)
    return docs


def _html_to_text(html: str) -> str:
    """Strip HTML to plain text for embedding. Cheap & dependency-free."""
    import re
    # remove tags
    text = re.sub(r"<[^>]+>", " ", html)
    # decode entities
    import html as htmlmod
    text = htmlmod.unescape(text)
    # collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_space(space_key: str) -> list[dict]:
    """Return Confluence articles for a space. No mock fallback — Confluence is the only KB source (v0.16.0)."""
    if confluence_cfg().get("base_url") and confluence_cfg().get("api_token"):
        return _fetch_confluence_rest(space_key)
    return []
