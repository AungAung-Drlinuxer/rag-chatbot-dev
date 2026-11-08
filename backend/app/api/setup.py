"""Setup readiness — what is still missing before this installation is usable.

One question drives this module: "an administrator has just walked through Settings →
Integrations; is there anything left to do outside the UI?" The answer must come from the
database, not from a checklist someone typed into the frontend, because the whole point is
to catch a half-finished install (an empty KB, no administrator, a database that is missing
pgvector) before a user hits it.

Every step reports one of:
    done    — verified against the database or a live config lookup
    todo    — an action the administrator can take in the UI
    blocked — an action only someone with server access can take (shown, never guessed at)

This endpoint never returns credential values and never performs a write.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.persistence.database import SessionLocal

router = APIRouter()

# Tables the application cannot run without (ORM models + hand-written core tables). The
# full install also creates LangGraph's checkpoint tables and, on first ingest, the vector
# store — those are reported separately because they are created lazily.
REQUIRED_TABLES = 24


def _settings(s, key: str) -> dict:
    row = s.execute(text("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    value = row[0] if row else None
    return value if isinstance(value, dict) else {}


def _has(cfg: dict, *keys: str) -> bool:
    return all(str(cfg.get(k) or "").strip() for k in keys)


def _database(s) -> dict:
    tables = int(s.execute(text(
        "SELECT count(*) FROM pg_tables WHERE schemaname='public'")).scalar() or 0)
    vector = s.execute(text(
        "SELECT extversion FROM pg_extension WHERE extname='vector'")).scalar()
    checkpoint = s.execute(text(
        "SELECT to_regclass('public.checkpoints') IS NOT NULL")).scalar()
    return {"tables": tables, "vector_version": vector, "checkpoints": bool(checkpoint),
            "ok": tables >= REQUIRED_TABLES and vector is not None}


def _knowledge(s) -> dict:
    cfg = _settings(s, "confluence")
    articles = int(s.execute(text("SELECT count(*) FROM kb_meta")).scalar() or 0)
    domains = int(s.execute(text("SELECT count(*) FROM classifier_domains")).scalar() or 0)
    row = s.execute(text("SELECT value FROM runtime_kv WHERE key = 'kb_last_sync'")).first()
    last = row[0] if row else None
    if isinstance(last, str):
        import json as _json
        try:
            last = _json.loads(last)
        except Exception:  # noqa: BLE001
            last = None
    # Field names come from the panels in Settings → Integrations (`api_token`, not `token`);
    # a readiness check that reads the wrong key reports "not connected" on a working install.
    spaces = cfg.get("space_keys") or cfg.get("spaces") or ""
    if isinstance(spaces, str):
        spaces = [x for x in spaces.replace("\n", ",").split(",") if x.strip()]
    return {
        "confluence_configured": _has(cfg, "base_url", "api_token", "email"),
        "spaces": [str(x).strip() for x in spaces if str(x).strip()],
        "articles": articles,
        "domains": domains,
        "last_sync": last,
    }


def _integrations(s) -> dict:
    jira = _settings(s, "jira")
    ldap = _settings(s, "ldap")
    sso = _settings(s, "keycloak")
    # SSO is "ready" on the same terms the login page uses (app.auth.sso.sso_enabled), so a
    # green checklist cannot disagree with the presence of the SSO button.
    try:
        from app.auth.sso import sso_enabled as _sso_enabled

        sso_ready = bool(_sso_enabled())
    except Exception:  # noqa: BLE001
        sso_ready = _has(sso, "issuer", "realm", "client_id", "redirect_uri")
    return {
        "jira": {"configured": _has(jira, "base_url", "api_token", "email"),
                 "project": jira.get("project_key") or jira.get("project")},
        "ldap": {"configured": _has(ldap, "host", "base_dn", "bind_dn")},
        # The redirect URI is part of "ready": Keycloak rejects the login flow without it,
        # and an operator who forgets it sees a generic error on the login page.
        "keycloak": {"configured": sso_ready,
                     "redirect_uri": sso.get("redirect_uri") or ""},
    }


@router.get("/api/setup/readiness")
def setup_readiness(user: str = Depends(get_current_user)) -> dict:
    with SessionLocal() as s:
        db = _database(s)
        admins = int(s.execute(text(
            "SELECT count(*) FROM users WHERE role_override = 'admin'")).scalar() or 0)
        kb = _knowledge(s)
        integrations = _integrations(s)

    steps: list[dict] = []

    steps.append({
        "key": "database",
        "label": "Database",
        "status": "done" if db["ok"] else "blocked",
        "detail": (f"{db['tables']} tables · pgvector {db['vector_version']}"
                   if db["ok"] else
                   f"{db['tables']} tables · pgvector {db['vector_version'] or 'missing'}"),
        "hint": "" if db["ok"] else
                "Run the installer: python -m app.bootstrap --init (needs the superuser URL)",
    })

    steps.append({
        "key": "administrator",
        "label": "Administrator",
        "status": "done" if admins else "blocked",
        "detail": f"{admins} admin account{'s' if admins != 1 else ''}" if admins else "none yet",
        "hint": "" if admins else
                "Create one with: python -m app.bootstrap --admin <username>",
    })

    if kb["confluence_configured"]:
        if kb["articles"]:
            steps.append({
                "key": "knowledge",
                "label": "Knowledge base",
                "status": "done",
                "detail": f"{kb['articles']} articles · {kb['domains']} domains",
                "hint": "",
            })
        else:
            steps.append({
                "key": "knowledge",
                "label": "Knowledge base",
                "status": "todo",
                "detail": "Confluence connected, nothing indexed yet",
                "hint": "Open Knowledge and press Sync — or wait for the sync queued by saving credentials",
            })
    else:
        steps.append({
            "key": "knowledge",
            "label": "Knowledge base",
            "status": "todo",
            "detail": "No document source connected",
            "hint": "Add Confluence under Settings → Integrations",
        })

    steps.append({
        "key": "ticketing",
        "label": "Ticketing",
        "status": "done" if integrations["jira"]["configured"] else "todo",
        "detail": ("Jira connected" if integrations["jira"]["configured"]
                   else "Jira not connected — the Tickets page reads the local table only"),
        "hint": "" if integrations["jira"]["configured"] else
                "Add Jira base URL, account email and API token",
    })

    dir_done = integrations["ldap"]["configured"] or integrations["keycloak"]["configured"]
    steps.append({
        "key": "identity",
        "label": "Directory / SSO",
        "status": "done" if dir_done else "todo",
        "detail": (" · ".join(x for x in [
            "LDAP" if integrations["ldap"]["configured"] else "",
            "SSO" if integrations["keycloak"]["configured"] else ""] if x) or "neither configured"),
        "hint": "" if dir_done else
                "Optional: connect LDAP for directory logins, or Keycloak for SSO",
    })

    ready = all(step["status"] == "done" for step in steps if step["key"] != "identity")
    return {
        "ready": ready,
        "steps": steps,
        "database": db,
        "knowledge": kb,
        "integrations": integrations,
        "users": {"admins": admins},
    }
