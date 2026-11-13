"""Confluence/Jira connections — one row per site, because a token is site-scoped.

The original design kept a single `system_settings` row per provider, which quietly assumed
one Confluence and one Jira. An estate with its own instance plus an HQ instance cannot be
described by that: the URL, the account and the token all differ per site, and a token
issued by one site authenticates nothing on the other.

A connection is therefore the unit of configuration. This module is the only place that
knows how to read/write them, so the fetchers and the API cannot drift apart.
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from app.persistence.database import SessionLocal

logger = logging.getLogger("integrations.connections")

PROVIDERS = ("confluence", "jira")


def _row_to_dict(row: Any, include_secret: bool = False) -> dict:
    out = {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "base_url": row["base_url"],
        "email": row["email"] or "",
        "cloud_id": row["cloud_id"] or "",
        "spaces": parse_spaces(row["spaces"]),
        "project_key": row["project_key"] or "",
        "active": bool(row["active"]),
        "last_sync_at": row["last_sync_at"].isoformat() if row["last_sync_at"] else None,
        "last_error": row["last_error"],
    }
    if include_secret:
        out["api_token"] = row["api_token"] or ""
    else:
        # Same rule as the legacy settings endpoint: the client learns whether a token is
        # set, never what it is.
        out["token_set"] = bool(row["api_token"])
    return out


def parse_spaces(raw: Any) -> list[str]:
    """Accept a JSON array, a comma string, or None — all three exist in the wild."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(s).strip() for s in raw if str(s).strip()]
    try:
        val = json.loads(raw)
        if isinstance(val, list):
            return [str(s).strip() for s in val if str(s).strip()]
    except Exception:
        pass
    return [s.strip() for s in str(raw).split(",") if s.strip()]


def list_connections(provider: str | None = None, active_only: bool = False,
                     include_secret: bool = False) -> list[dict]:
    where, params = [], {}
    if provider:
        where.append("provider = :p")
        params["p"] = provider
    if active_only:
        where.append("active IS TRUE")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with SessionLocal() as s:
        rows = s.execute(text(
            f"SELECT * FROM integration_connections {clause} ORDER BY provider, label, id"
        ), params).mappings().all()
    return [_row_to_dict(r, include_secret=include_secret) for r in rows]


def get_connection(cid: int, include_secret: bool = True) -> dict | None:
    with SessionLocal() as s:
        row = s.execute(text("SELECT * FROM integration_connections WHERE id = :i"),
                        {"i": cid}).mappings().first()
    return _row_to_dict(row, include_secret=include_secret) if row else None


def create_connection(data: dict) -> dict:
    provider = str(data.get("provider") or "").strip().lower()
    if provider not in PROVIDERS:
        raise ValueError("provider must be 'confluence' or 'jira'")
    label = str(data.get("label") or "").strip()
    base_url = str(data.get("base_url") or "").strip().rstrip("/")
    if not label:
        raise ValueError("label is required — it is what the UI and citations call this site")
    if not base_url:
        raise ValueError("base_url is required")
    spaces = data.get("spaces")
    if isinstance(spaces, list):
        spaces = json.dumps([s.strip() for s in spaces if str(s).strip()])
    with SessionLocal() as s:
        row = s.execute(text("""
            INSERT INTO integration_connections
                (provider, label, base_url, email, api_token, cloud_id, spaces, project_key, active)
            VALUES (:provider, :label, :base_url, :email, :api_token, :cloud_id, :spaces,
                    :project_key, :active)
            ON CONFLICT (provider, base_url) DO UPDATE SET
                label = EXCLUDED.label, email = EXCLUDED.email,
                api_token = COALESCE(NULLIF(EXCLUDED.api_token, ''), integration_connections.api_token),
                cloud_id = EXCLUDED.cloud_id, spaces = EXCLUDED.spaces,
                project_key = EXCLUDED.project_key, active = EXCLUDED.active
            RETURNING id
        """), {
            "provider": provider, "label": label, "base_url": base_url,
            "email": str(data.get("email") or ""),
            "api_token": str(data.get("api_token") or ""),
            "cloud_id": str(data.get("cloud_id") or ""),
            "spaces": spaces if isinstance(spaces, (str, type(None))) else None,
            "project_key": str(data.get("project_key") or ""),
            "active": bool(data.get("active", True)),
        }).scalar()
        s.commit()
    return get_connection(int(row), include_secret=False) or {}


def update_connection(cid: int, data: dict) -> dict | None:
    current = get_connection(cid, include_secret=True)
    if not current:
        return None
    token = str(data.get("api_token") or "").strip()
    if token.startswith("••") or token == "***":
        token = ""  # the UI echoes a mask back; never overwrite a real token with it
    spaces = data.get("spaces", current["spaces"])
    if isinstance(spaces, list):
        spaces = json.dumps([s.strip() for s in spaces if str(s).strip()])
    with SessionLocal() as s:
        s.execute(text("""
            UPDATE integration_connections SET
                label = :label, base_url = :base_url, email = :email,
                api_token = COALESCE(NULLIF(:api_token, ''), api_token),
                cloud_id = :cloud_id, spaces = :spaces, project_key = :project_key,
                active = :active
            WHERE id = :i
        """), {
            "i": cid,
            "label": str(data.get("label", current["label"])),
            "base_url": str(data.get("base_url", current["base_url"])).rstrip("/"),
            "email": str(data.get("email", current["email"])),
            "api_token": token,
            "cloud_id": str(data.get("cloud_id", current["cloud_id"])),
            "spaces": spaces if isinstance(spaces, (str, type(None))) else None,
            "project_key": str(data.get("project_key", current["project_key"])),
            "active": bool(data.get("active", current["active"])),
        })
        s.commit()
    return get_connection(cid, include_secret=False)


def delete_connection(cid: int) -> bool:
    with SessionLocal() as s:
        res = s.execute(text("DELETE FROM integration_connections WHERE id = :i"), {"i": cid})
        s.commit()
        return bool(res.rowcount)


def touch_sync(cid: int | None, error: str | None = None) -> None:
    """Record the outcome of a sync for one connection."""
    if not cid:
        return
    with SessionLocal() as s:
        s.execute(text(
            "UPDATE integration_connections SET last_sync_at = :ts, last_error = :err "
            "WHERE id = :i"
        ), {"i": cid, "ts": datetime.now(UTC), "err": (error or None) and error[:500]})
        s.commit()


def legacy_connection(provider: str) -> dict | None:
    """The single `system_settings` row, presented as a connection with id None.

    This is what keeps an existing install working: until an operator adds a real
    connection, the fetchers see exactly one connection — the legacy one — and behave as
    they did before multi-site support."""
    from app.integrations.confluence import confluence_cfg
    from app.integrations.jira import _jira_cfg

    if provider == "confluence":
        cfg = confluence_cfg()
        if not (cfg.get("base_url") and cfg.get("api_token")):
            return None
        return {
            "id": None, "provider": "confluence", "label": "Default Confluence",
            "base_url": cfg.get("base_url", ""), "email": cfg.get("email", ""),
            "api_token": cfg.get("api_token", ""), "cloud_id": cfg.get("cloud_id", ""),
            "spaces": parse_spaces(cfg.get("space_keys")),
            "project_key": "", "active": True, "last_sync_at": None, "last_error": None,
        }
    cfg = _jira_cfg()
    if not (cfg.get("base_url") and cfg.get("api_token")):
        return None
    return {
        "id": None, "provider": "jira", "label": "Default Jira",
        "base_url": cfg.get("base_url", ""), "email": cfg.get("email", ""),
        "api_token": cfg.get("api_token", ""), "cloud_id": "",
        "spaces": [], "project_key": cfg.get("project", ""),
        "active": True, "last_sync_at": None, "last_error": None,
    }


def effective_connections(provider: str, include_secret: bool = True) -> list[dict]:
    """Active connections, or the legacy one when none are configured yet."""
    rows = list_connections(provider, active_only=True, include_secret=include_secret)
    if rows:
        return rows
    legacy = legacy_connection(provider)
    return [legacy] if legacy else []


def site_of(base_url: str) -> str:
    """Host of a site URL — what citations show next to the logo."""
    from urllib.parse import urlparse

    try:
        host = urlparse(base_url if "//" in base_url else f"https://{base_url}").hostname
    except Exception:
        return ""
    return host or ""
