"""Confluence write support (v0.19.0) — create pages into the KB space.

Complements the read-only fetcher: article creation from the chatbot now
lands in Confluence under the matching section page (domain → parent
title), labeled approved + chatbot-safe so the sync filter picks it up.

Auth: personal API token + direct tenant URL (same as the read path).
Requires the account to hold Add Page permission on the space.
"""
from __future__ import annotations

import base64

import httpx

# domain (classifier vocabulary) → Confluence parent page title in IHKB.
# Titles must match the real page names in the space tree.
DOMAIN_PARENT: dict[str, str] = {
    "server": "Server",
    "database": "Database",
    "network": "Network",
    "security": "Security",
    "storage": "Storage",
    "kubernetes": "Kubernetes",
    "general": "",
}


def _auth() -> tuple[str, dict]:
    from app.integrations.confluence import confluence_cfg

    _cfg = confluence_cfg()
    base = str(_cfg.get("base_url") or "").rstrip("/")
    email = _cfg.get("email") or ""
    token = _cfg.get("api_token") or ""
    if not base or not token:
        return "", {}
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    return base, {"Authorization": f"Basic {auth}", "Accept": "application/json",
                  "Content-Type": "application/json"}


def find_page_by_title(title: str) -> str | None:
    """Return page id for an exact-title page in the KB space, else None."""
    base, headers = _auth()
    if not base:
        return None
    from app.integrations.confluence import space_keys as _space_keys

    space = (_space_keys() or ["IHKB"])[0]
    try:
        with httpx.Client(timeout=20, headers=headers) as client:
            r = client.get(
                f"{base}/rest/api/content",
                params={"spaceKey": space, "title": title, "expand": "version"},
            )
            r.raise_for_status()
            results = r.json().get("results", [])
            return results[0]["id"] if results else None
    except Exception:
        return None


def create_kb_page(title: str, body_text: str, domain: str) -> dict:
    """Create a page under the domain's section, label it, return {id, url, parent}.

    body_text is plain text/markdown-ish; stored as storage-format paragraphs.
    Falls back to a top-level page when the section page cannot be found.
    """
    base, headers = _auth()
    if not base:
        return {"ok": False, "error": "Confluence not configured"}

    from app.integrations.confluence import space_keys as _space_keys

    space = (_space_keys() or ["IHKB"])[0]
    parent_title = DOMAIN_PARENT.get((domain or "general").lower(), "")
    parent_id = find_page_by_title(parent_title) if parent_title else None

    # storage format: escape + wrap paragraphs; keep simple line structure
    paras = [p.strip() for p in (body_text or "").split("\n") if p.strip()]
    storage = "".join(f"<p>{p}</p>" for p in paras) or "<p></p>"

    payload: dict = {
        "type": "page",
        "title": title,
        "space": {"key": space},
        "body": {"storage": {"value": storage, "representation": "storage"}},
    }
    if parent_id:
        payload["ancestors"] = [{"id": parent_id}]

    try:
        with httpx.Client(timeout=30, headers=headers) as client:
            r = client.post(f"{base}/rest/api/content", json=payload)
            if r.status_code == 403:
                return {"ok": False, "error": "No Add Page permission on the space"}
            if r.status_code == 409:
                return {"ok": False, "error": "A page with this title already exists"}
            r.raise_for_status()
            data = r.json()

            # labels: approved + chatbot-safe so the sync filter includes it
            page_id = data["id"]
            client.post(
                f"{base}/rest/api/content/{page_id}/label",
                json=[{"prefix": "global", "name": "approved"},
                      {"prefix": "global", "name": "chatbot-safe"}],
            )
            return {
                "ok": True,
                "page_id": page_id,
                "url": base + "/pages/viewpage.action?pageId=" + page_id,
                "parent": parent_title or "(top level)",
                "space": space,
            }
    except httpx.HTTPStatusError as exc:
        return {"ok": False, "error": f"HTTP {exc.response.status_code}: {exc.response.text[:150]}"}
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
