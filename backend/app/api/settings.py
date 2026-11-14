from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role, require_role
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

def validate_ldap_payload(data: dict) -> dict:
    """Catch the two LDAP mistakes that produce "every login 401".

    A filter without `{username}` matches the same entry for every login, and a
    non-numeric port silently builds an unreachable URL. Both are accepted by the
    directory library at save time and only fail when a real user tries to sign in.
    """
    out = dict(data)
    flt = out.get("user_filter")
    if isinstance(flt, str) and flt.strip() not in ("", "__CLEAR__"):
        if "{username}" not in flt:
            raise HTTPException(
                status_code=400,
                detail="user_filter must contain the {username} placeholder, "
                       "e.g. (sAMAccountName={username})",
            )
    port = out.get("port")
    if isinstance(port, str) and port.strip() not in ("", "__CLEAR__"):
        if not port.strip().isdigit():
            raise HTTPException(status_code=400, detail="port must be numeric (389 or 636)")
        out["port"] = port.strip()
    return out


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_account_email(data: dict, label: str) -> None:
    """Atlassian Cloud wants Basic auth: the account email + the token created by that account.

    The token alone cannot authenticate. Saving the integration without the email used to be
    accepted, and the runtime then paired the token with the email from the environment — a
    different Atlassian account — so every call came back 403 while the panel showed "saved".
    Refuse the save instead.
    """
    if not data.get("base_url"):
        return  # nothing being configured here
    email = str(data.get("email") or "").strip()
    if not email or email == "__CLEAR__":
        raise HTTPException(
            status_code=400,
            detail=f"{label}: the account email is required — it must be the Atlassian account "
                   "that created the API token",
        )
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail=f"{label}: '{email}' is not an email address")


def validate_confluence_payload(data: dict) -> dict:
    _require_account_email(data, "Confluence")
    return dict(data)


def validate_jira_payload(data: dict) -> dict:
    """Check the two JSM fields before they reach the database.

    `service_desk_id` and `request_types` decide whether an escalation becomes a JSM
    customer request or a plain Task. A typo here is silent — the ticket still gets
    created, just through the fallback — so validate the shape at save time instead of
    discovering it from a bad ticket later.
    """
    _require_account_email(data, "Jira")
    out = dict(data)
    desk = out.get("service_desk_id")
    if isinstance(desk, str) and desk.strip() not in ("", "__CLEAR__"):
        if not desk.strip().isdigit():
            raise HTTPException(
                status_code=400,
                detail="service_desk_id must be the numeric JSM service desk id (e.g. 12)",
            )
        out["service_desk_id"] = desk.strip()

    rt = out.get("request_types")
    parsed = None
    if isinstance(rt, dict):
        parsed = rt
    elif isinstance(rt, str) and rt.strip() not in ("", "__CLEAR__"):
        try:
            parsed = json.loads(rt)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail='request_types must be a JSON object mapping domain to request type id, '
                       'e.g. {"general": "100", "server": "101"}',
            ) from None
    if parsed is not None:
        if not isinstance(parsed, dict) or not parsed:
            raise HTTPException(
                status_code=400,
                detail='request_types must be a JSON object mapping domain to request type id, '
                       'e.g. {"general": "100", "server": "101"}',
            )
        bad = [k for k, v in parsed.items() if not isinstance(k, str) or not str(v).strip().isdigit()]
        if bad:
            raise HTTPException(
                status_code=400,
                detail=f"request type ids must be numeric strings; check: {', '.join(map(str, bad))}",
            )
        out["request_types"] = json.dumps({k.strip().lower(): str(v).strip() for k, v in parsed.items()})
    return out




def _json_dict(raw, default: dict | None = None) -> dict:
    """Decode a `system_settings.value` column into a dict.

    The column is JSONB in prod but plain TEXT in some older rows, so a stored
    value can arrive as a str, as a dict, or as None. Ten endpoints used to
    repeat this decode inline, which is why a fix to one copy never reached the
    others. Unknown / malformed shapes degrade to `default` rather than raising:
    a corrupt settings blob must not take the endpoint down.
    """
    if raw is None:
        return dict(default or {})
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return dict(default or {})
    return raw if isinstance(raw, dict) else dict(default or {})


def _load_setting(key: str, default: dict | None = None) -> dict:
    """Read one `system_settings` row and decode it. Missing row -> `default`."""
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": key}).first()
    return _json_dict(row[0] if row else None, default)

from fastapi import File as _FILE
from fastapi import Form as _FORM
from fastapi import UploadFile as _UPLOAD_FILE

from app.observability.audit import audit
from app.schemas import BrandingResponse

router = APIRouter(prefix="/api")

def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]

# === v0.21.37 — SMTP email notification settings (admin only) ===
SMTP_KEYS = {"host", "port", "username", "password", "from_address", "use_tls", "enabled", "alerts"}

def _require_admin(user: str) -> None:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Forbidden: admin only")

@router.get("/settings/smtp")
def get_smtp_settings(user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    val = _json_dict(row[0] if row else None)
    # v1.6.35 — same write-only policy as the integrations: no stored value is
    # returned (host / username / from-address were being echoed verbatim, and the
    # smarthost account name is itself sensitive in most enterprises).
    from app.security.credentials import MASK, fields_set, redact_config

    set_keys = fields_set(val)
    return {
        "smtp": redact_config(val),
        "fields_set": set_keys,
        "mask": MASK,
        "configured": bool(set_keys),
        "password_set": bool(val.get("password")),
    }

@router.put("/settings/smtp")
def put_smtp_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    data = payload.get("smtp")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="smtp object required")
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
        current = _json_dict(row[0] if row else None)
        # merge; empty password keeps the existing one
        for k, v in data.items():
            if k in SMTP_KEYS:
                if k == "password" and not v:
                    continue
                current[k] = v
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES ('smtp', :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"v": json.dumps(current)})
        s.commit()
    return {"ok": True}

@router.post("/settings/smtp/test")
def send_test_email(payload: dict, user: str = Depends(get_current_user)) -> dict:
    _require_admin(user)
    import smtplib
    import ssl as _ssl
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'smtp'")).first()
    cfg = _json_dict(row[0] if row else None)
    host = cfg.get("host"); port = int(cfg.get("port") or 587)
    username = cfg.get("username"); password = cfg.get("password")
    from_addr = cfg.get("from_address") or username
    to_addr = payload.get("to") or username
    if not host or not from_addr:
        raise HTTPException(status_code=400, detail="SMTP host or from address is not configured")
    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = to_addr
    # No product name is baked in: the brand the administrator set, or the neutral
    # default. A test email that says somebody else's product name is a support ticket.
    from app.branding import app_name as _app_name
    brand = _app_name()
    msg["Subject"] = f"{brand} — Test email"
    msg.attach(MIMEText(f"SMTP configuration test successful. ({brand})", "plain", "utf-8"))
    try:
        use_ssl = port == 465
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=15,
                                  context=_ssl.create_default_context()) as srv:
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
        else:
            with smtplib.SMTP(host, port, timeout=15) as srv:
                srv.ehlo()
                if cfg.get("use_tls", True):
                    srv.starttls(context=_ssl.create_default_context())
                    srv.ehlo()
                if username and password:
                    srv.login(username, password)
                srv.sendmail(from_addr, [to_addr], msg.as_string())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Send failed: {exc}")
    return {"ok": True, "to": to_addr}


# === v0.21.40 — integration settings (Confluence / Jira) ===
# This deployment syncs from Confluence and raises tickets in Jira. Everything else was
# removed: a provider the product does not run is not a setting, and accepting its key here
# would let an admin save a sync that has nowhere to go. `ldap` stays because it is the
# authentication backend, not a content connector.
INTEGRATION_KEYS = {"confluence", "jira", "ldap", "keycloak", "llm", "redis", "ollama"}

# ClinePass is an OpenAI-compatible gateway (api.cline.bot). Two things make it
# different from the other providers and are handled below:
#   * the generic GET /models listing omits cline-pass/* ids — the public
#     recommended-models feed carries them under the `clinePass` key
#   * GET /models answers 200 even without a key, so it cannot validate one;
#     a 1-token chat completion returns 401/403 for a bad key instead
CLINEPASS_CATALOG_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models"
CLINEPASS_ALIASES = {"clinepass", "cline-pass", "cline"}
CLINEPASS_HOSTS = {"api.cline.bot"}


def _llm_provider_id(cfg: dict) -> str:
    """Normalised provider id from a stored llm config ("ClinePass" -> "clinepass")."""
    return str((cfg or {}).get("provider") or "").strip().lower()


def _is_clinepass(cfg: dict) -> bool:
    """True when the stored llm config points at ClinePass."""
    if _llm_provider_id(cfg) in CLINEPASS_ALIASES:
        return True
    try:
        from urllib.parse import urlparse

        host = (urlparse(str((cfg or {}).get("base_url") or "")).hostname or "").lower()
    except Exception:
        host = ""
    return host in CLINEPASS_HOSTS


def _clinepass_catalog() -> list[dict] | None:
    """Live ClinePass model catalogue as [{id, name}], or None when unreachable."""
    import httpx

    try:
        r = httpx.get(CLINEPASS_CATALOG_URL, timeout=20,
                      headers={"Accept": "application/json"})
        if r.status_code != 200:
            return None
        block = (r.json() or {}).get("clinePass") or []
    except Exception as exc:
        logger.warning("clinepass catalogue fetch failed: %s", exc)
        return None
    out: list[dict] = []
    for m in block:
        mid = m.get("id") if isinstance(m, dict) else None
        if not isinstance(mid, str) or not mid:
            continue
        out.append({"id": mid, "name": str(m.get("name") or mid)})
    return out or None

def _reload_after_change(key: str) -> None:
    """Drop any in-process cache that mirrors the integration config we just wrote."""
    if key == "llm":
        from app.llm.client import reload_llm_cfg
        reload_llm_cfg()
    if key == "jira":
        from app.integrations.jira import reload_jira_cfg
        reload_jira_cfg()
    if key == "confluence":
        from app.integrations.confluence import reload_confluence_cfg
        reload_confluence_cfg()
    if key == "ldap":
        from app.auth.ldap_auth import reload_ldap_cfg
        reload_ldap_cfg()

# --- Multi-site connections --------------------------------------------------
# One row per Confluence/Jira site. Kept on their own prefix (`/settings/connections`)
# because `/settings/integrations/{key}` would otherwise swallow "connections" as a key.

# --- Data retention ---------------------------------------------------------
# Two windows, one decision each. `null` means keep forever and is the only safe default:
# a missing or malformed row must never be read as "delete everything older than 0 days".

@router.get("/settings/retention")
def get_retention(user: str = Depends(require_role("admin"))) -> dict:
    from app.retention import ALLOWED_DAYS, get_policy, last_run, scope_counts

    from app.retention import oldest, totals

    policy = get_policy()
    return {
        "policy": policy,
        "preview": scope_counts(policy),
        "totals": totals(),
        "oldest": {k: (v.isoformat() if v else None) for k, v in oldest().items()},
        "last_run": last_run(),
        "allowed_days": sorted(ALLOWED_DAYS),
    }


@router.put("/settings/retention")
def put_retention(payload: dict, user: str = Depends(require_role("admin"))) -> dict:
    from app.retention import get_policy, scope_counts, set_policy

    try:
        policy = set_policy(payload.get("conversations_days"), payload.get("audit_days"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    from app.retention import totals

    audit("retention_changed", user,
          detail=f"conversations={policy.get('conversations_days')} audit={policy.get('audit_days')}")
    return {"ok": True, "policy": policy, "preview": scope_counts(policy), "totals": totals()}


@router.post("/settings/retention/run")
def run_retention(confirm: str | None = None,
                  user: str = Depends(require_role("admin"))) -> dict:
    """Delete expired rows NOW (the nightly task would do it anyway).

    Requires the word DELETE: the preview shows counts, but a single mis-click must not be
    able to erase a year of conversations.
    """
    from app.retention import get_policy, purge, scope_counts

    if (confirm or "").strip().upper() != "DELETE":
        raise HTTPException(status_code=400, detail="Confirmation required: ?confirm=DELETE")
    policy = get_policy()
    if not policy.get("conversations_days") and not policy.get("audit_days"):
        return {"ok": True, "removed": {}, "note": "Both windows are set to keep forever."}
    from app.retention import totals

    removed = purge(policy)
    audit("retention_run", user, detail=json.dumps(removed)[:400])
    return {"ok": True, "removed": removed, "preview": scope_counts(policy), "totals": totals()}


@router.get("/settings/connections")
def list_connections_endpoint(provider: str | None = None,
                              user: str = Depends(require_role("admin"))) -> dict:
    from app.integrations.connections import list_connections

    if provider and provider not in ("confluence", "jira"):
        raise HTTPException(status_code=400, detail="provider must be confluence or jira")
    return {"connections": list_connections(provider, include_secret=False)}


@router.put("/settings/connections/order")
def reorder_connections_endpoint(payload: dict,
                                 user: str = Depends(require_role("admin"))) -> dict:
    """Renumber one provider's sites in the order the admin dragged them."""
    from app.integrations.connections import reorder_connections

    provider = str(payload.get("provider") or "").strip().lower()
    ids = payload.get("ids") or []
    if not isinstance(ids, list):
        raise HTTPException(status_code=400, detail="ids must be a list of connection ids")
    try:
        rows = reorder_connections(provider, ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit("update", user, detail=f"connections:order:{provider}")
    return {"ok": True, "connections": rows}


@router.post("/settings/connections")
def create_connection_endpoint(payload: dict,
                               user: str = Depends(require_role("admin"))) -> dict:
    from app.integrations.connections import create_connection

    try:
        conn = create_connection(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit("create", user, detail=f"connection:{conn.get('provider')}:{conn.get('id')}")
    out: dict = {"ok": True, "connection": conn}
    if conn.get("provider") == "confluence":
        out["sync"] = _kickoff_kb_sync()
    return out


@router.put("/settings/connections/{cid}")
def update_connection_endpoint(cid: int, payload: dict,
                               user: str = Depends(require_role("admin"))) -> dict:
    from app.integrations.connections import update_connection

    conn = update_connection(cid, payload)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    audit("update", user, detail=f"connection:{conn.get('provider')}:{cid}")
    return {"ok": True, "connection": conn}


@router.delete("/settings/connections/{cid}")
def delete_connection_endpoint(cid: int, confirm: str | None = None,
                               user: str = Depends(require_role("admin"))) -> dict:
    from app.integrations.connections import delete_connection, get_connection

    conn = get_connection(cid, include_secret=False)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    # Deleting a connection does not delete what it already ingested; say so, and require
    # the label so a mis-click cannot silently stop a site from syncing.
    if confirm != conn["label"]:
        raise HTTPException(
            status_code=400,
            detail=f"Confirmation required: call DELETE /api/settings/connections/{cid}"
                   f"?confirm={conn['label']}",
        )
    delete_connection(cid)
    audit("delete", user, detail=f"connection:{conn.get('provider')}:{cid}")
    return {"ok": True, "deleted": cid}


@router.post("/settings/connections/{cid}/test")
def test_connection_endpoint(cid: int, user: str = Depends(require_role("admin"))) -> dict:
    """Probe one site with its own token — the only honest way to say 'connected'."""
    import httpx

    from app.integrations.connections import get_connection

    conn = get_connection(cid, include_secret=True)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    base = (conn.get("base_url") or "").rstrip("/")
    if not base:
        return {"ok": False, "status": None, "detail": "base_url not set"}
    try:
        if conn["provider"] == "confluence":
            if conn.get("cloud_id"):
                url = f"https://api.atlassian.com/ex/confluence/{conn['cloud_id']}/wiki/rest/api/content"
                headers = {"Authorization": f"Bearer {conn.get('api_token') or ''}"}
                r = httpx.get(url, params={"limit": 1}, headers=headers, timeout=15)
            else:
                r = httpx.get(f"{base}/rest/api/content", params={"limit": 1},
                              auth=(conn.get("email") or "", conn.get("api_token") or ""),
                              timeout=15)
        else:
            r = httpx.get(f"{base}/rest/api/3/myself",
                          auth=(conn.get("email") or "", conn.get("api_token") or ""),
                          timeout=15)
        ok = r.status_code in (200, 201)
        detail = "" if ok else r.text[:200]
        if ok and conn["provider"] == "confluence":
            # `size` on /rest/api/content is how many rows this response carried (we ask for
            # one), not how much the account can see — the old text therefore read
            # "1 pages visible" on a perfectly connected site. Spaces are the honest unit:
            # they are what the sync walks, and a configured key missing from the list is the
            # failure an admin actually needs to be told about.
            try:
                sp_url = (f"https://api.atlassian.com/ex/confluence/{conn['cloud_id']}/wiki/rest/api/space"
                          if conn.get("cloud_id") else f"{base}/rest/api/space")
                sp_headers = ({"Authorization": f"Bearer {conn.get('api_token') or ''}"}
                              if conn.get("cloud_id") else None)
                sp = httpx.get(sp_url, params={"limit": 100},
                               headers=sp_headers,
                               auth=None if sp_headers else (conn.get("email") or "", conn.get("api_token") or ""),
                               timeout=15)
                keys = [str(x.get("key") or "") for x in sp.json().get("results", [])] if sp.status_code == 200 else []
                wanted = [str(x).strip() for x in (conn.get("spaces") or []) if str(x).strip()]
                missing = [w for w in wanted if w not in keys]
                detail = (f"{len(keys)} space{'s' if len(keys) != 1 else ''} visible"
                          + (f" · not listed: {', '.join(missing)}" if missing else "")
                          if keys else "connected (space list not readable)")
            except Exception:
                detail = "connected"
        return {"ok": ok, "status": r.status_code, "detail": detail}
    except Exception as exc:
        return {"ok": False, "status": None, "detail": f"{type(exc).__name__}: {exc}"[:300]}


@router.get("/settings/integrations/{key}")
def get_integration_settings(key: str, user: str = Depends(require_role("admin"))) -> dict:
    """Return the integration's configuration WITHOUT any stored value.

    v1.6.35 — WRITE-ONLY. The previous filter dropped only `*_token` / `*_password`,
    which leaked `api_key` (Models Provider), `client_secret` (Keycloak) and every
    identifier (`base_url`, `email`, `host`, `bind_dn`, ...) in plaintext — an admin
    token could read secrets straight back out.

    Nothing is echoed now: the client receives mask tokens plus `fields_set` /
    `secret_fields` so the UI can render "configured" without being able to recover
    the value. Confirming a configuration is done with the Test endpoint, which
    runs server-side.
    """
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")


    from app.security.credentials import (
        MASK,
        fields_set,
        redact_config,
        secret_fields_set,
    )

    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(
            _t("SELECT value, updated_at FROM system_settings WHERE key = :k"), {"k": key}
        ).first()

    val = row[0] if row else {}
    updated_at = row[1] if row else None
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            val = {}

    set_keys = fields_set(val)
    return {
        "integration": key,
        "configured": bool(set_keys),
        # every stored key is present but masked — no raw value ever leaves here
        "settings": redact_config(val),
        # the UI renders from these flags, never from a returned value
        "fields_set": set_keys,
        "secret_fields": secret_fields_set(val),
        "mask": MASK,
        "updated_at": updated_at.isoformat() if updated_at else None,
        # kept for older clients
        "token_set": bool(secret_fields_set(val)),
    }


@router.delete("/settings/integrations/{key}")
def delete_integration_settings(
    key: str, confirm: str = "", user: str = Depends(require_role("admin"))
) -> dict:
    """Remove a stored integration configuration entirely ("disconnect").

    v1.6.35 — needed because a credential is write-only: an empty field means
    "keep the stored value", so there was previously NO way for an admin to
    revoke a saved token through the API.
    """
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    # Guard: this is unrecoverable (credentials are write-only, and there is no
    # settings backup), so require the caller to name the integration again.
    # `?confirm=<key>` prevents an accidental/scripted wipe of live config.
    if confirm != key:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Confirmation required: call DELETE /api/settings/integrations/{key}?confirm={key}. "
                "Removing an integration config cannot be undone and the stored credentials "
                "cannot be recovered."
            ),
        )
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t("DELETE FROM system_settings WHERE key = :k"), {"k": key})
        s.commit()
    _reload_after_change(key)
    return {"ok": True, "integration": key, "cleared": True}


@router.put("/settings/integrations/{key}")
def put_integration_settings(key: str, payload: dict, user: str = Depends(require_role("admin"))) -> dict:
    if key not in INTEGRATION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown integration")
    data = payload.get("settings")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="settings object required")
    if key == "jira":
        data = validate_jira_payload(data)
    elif key == "confluence":
        data = validate_confluence_payload(data)
    elif key == "ldap":
        data = validate_ldap_payload(data)
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
        current = _json_dict(row[0] if row else None)
        # v1.6.35 — central policy in app/security/credentials.py:
        #   mask echoed back -> refused (would destroy the real value)
        #   "__CLEAR__"      -> delete the field
        #   empty/absent     -> keep the stored value
        from app.security.credentials import apply_update
        current = apply_update(current, data)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": key, "v": json.dumps(current)})
        s.commit()
    _reload_after_change(key)
    result: dict = {"ok": True}
    # Saving Confluence credentials is the moment the KB becomes usable; start the first
    # sync here instead of making the admin discover the Sync button on another page.
    if key == "confluence":
        result["sync"] = _kickoff_kb_sync()
    return result

def _kickoff_kb_sync() -> str:
    """Queue one background sync after Confluence credentials are saved.

    WHY: an administrator who has just entered valid Confluence credentials expects the
    product to start working, not to be told to go and press Sync somewhere else. The sync
    already existed; saving credentials is the event that should trigger the first run.

    Deliberately deduplicated and non-fatal: a click-happy admin saving twice must not queue
    two 9-minute embedding jobs, and a broker outage must not fail the save that the
    operator just made.
    """
    import logging

    from app.integrations.confluence import confluence_cfg

    log = logging.getLogger("it-help-chatbot")
    try:
        cfg = confluence_cfg()
    except Exception as exc:
        log.info("kb sync not queued: %s", exc)
        return "not-configured"
    if not (cfg.get("base_url") and (cfg.get("api_token") or cfg.get("token"))):
        return "not-configured"

    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM runtime_kv WHERE key = 'kb_sync_kick'")).first()
        last = row[0] if row else None
        now = datetime.now(UTC)
        if last:
            try:
                import json as _json
                prev = _json.loads(last) if isinstance(last, str) else last
                at = datetime.fromisoformat(str(prev.get("at")))
                if (now - at).total_seconds() < 120:
                    return "already-pending"
            except Exception as _exc:
                logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
        s.execute(_t(
            "INSERT INTO runtime_kv (key, value) VALUES ('kb_sync_kick', :v) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
        ), {"v": __import__("json").dumps({"at": now.isoformat()})})
        s.commit()

    try:
        from workers.sync_tasks import sync_kb

        sync_kb.delay()
        log.info("kb sync queued after a credential change")
        return "queued"
    except Exception as exc:
        log.warning("kb sync not queued (%s): %s", type(exc).__name__, exc)
        return "unavailable"


@router.post("/settings/integrations/{key}/test")
def test_integration(key: str, user: str = Depends(require_role("admin"))) -> dict:
    """Connectivity test for Confluence / Jira."""
    import httpx
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"), {"k": key}).first()
    cfg = _json_dict(row[0] if row else None)
    try:
        if key == "confluence":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/content", params={"limit": 1},
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status not in (200, 201) else ""
        elif key == "jira":
            url = (cfg.get("base_url") or "").rstrip("/")
            if not url:
                raise ValueError("base_url not set")
            r = httpx.get(f"{url}/rest/api/3/myself",
                          auth=(cfg.get("email") or "", cfg.get("api_token") or ""), timeout=15)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "llm":
            base = (cfg.get("base_url") or "").rstrip("/")
            if not base:
                raise ValueError("base_url not set")
            _key = cfg.get("api_key") or ""
            if not _key:
                raise ValueError("api_key not set — enter your provider API key and Save first")
            _hdrs = {"Authorization": f"Bearer {_key}"}
            if _is_clinepass(cfg):
                # ClinePass answers GET /models with 200 even for a bad key, so a
                # catalogue fetch proves nothing about the credential. A 1-token
                # completion does: the gateway returns 401/403 when the key is
                # wrong, and also proves the stored model id is servable.
                _model = (cfg.get("model") or "").strip() or "cline-pass/deepseek-v4.1-flash"
                r = httpx.post(
                    f"{base}/chat/completions",
                    headers={**_hdrs, "Content-Type": "application/json"},
                    json={
                        "model": _model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "max_tokens": 1,
                        "stream": False,
                    },
                    timeout=20,
                )
                status = r.status_code
                detail = "" if status in (200, 201) else r.text[:200]
            else:
                r = httpx.get(f"{base}/models", headers=_hdrs, timeout=15)
                status = r.status_code
                detail = r.text[:200] if status != 200 else ""
        elif key == "ollama":
            host = (cfg.get("host") or "").rstrip("/")
            if not host:
                raise ValueError("host not set")
            r = httpx.get(f"{host}/api/tags", timeout=10)
            status = r.status_code
            detail = r.text[:200] if status != 200 else ""
        elif key == "redis":
            # TCP connect check (redis-ping needs a client dep; socket is enough)
            import socket
            host = cfg.get("host") or "127.0.0.1"
            port = int(cfg.get("port") or 6379)
            s = socket.create_connection((host, port), timeout=5)
            s.close()
            status, detail = 200, ""
        elif key == "ldap":
            # LDAP bind check via ldap3 using saved config (falls back to env config)
            host = cfg.get("host") or ""
            if not host:
                raise ValueError("host not set")
            port = int(cfg.get("port") or 389)
            from ldap3 import Connection, Server
            srv = Server(host, port=port, get_info=None, connect_timeout=5)
            conn = Connection(srv, user=cfg.get("bind_dn") or None,
                              password=cfg.get("bind_password") or None, auto_bind=False)
            conn.open()
            conn.unbind()
            status, detail = 200, ""
        elif key == "keycloak":
            # SSO connectivity: OIDC discovery on the realm issuer. A wrong realm or an
            # unreachable issuer is exactly what an admin needs to see before saving.
            issuer = (cfg.get("issuer") or cfg.get("base_url") or "").rstrip("/")
            if not issuer:
                raise ValueError("issuer not set")
            realm = cfg.get("realm") or "ith-chatbot"
            r = httpx.get(f"{issuer}/realms/{realm}/.well-known/openid-configuration", timeout=15)
            status = r.status_code
            detail = "" if r.status_code == 200 else r.text[:200]
        else:
            raise ValueError(f"no test for {key}")
        if status in (200, 201):
            payload = {"ok": True, "status": status}
            if detail and "detail" not in payload:
                payload["detail"] = detail
            return payload
        return {"ok": False, "status": status, "detail": detail}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)[:200]}


@router.get("/settings/integrations/llm/models")
def list_llm_models(user: str = Depends(require_role("admin"))) -> dict:
    """Fetch the model catalogue from the configured provider (saved key required).

    Returns [{id, name}] sorted by id. Used by the Settings -> Integrations ->
    Models Provider model selector so admins pick from the provider's real list.
    """
    # The route dependency is already require_role("admin"); the extra in-body check
    # re-tested a value that is not the username and locked an administrator out of the
    # model catalogue. One guard, in one place.
    import httpx
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = 'llm'")).first()
    cfg = _json_dict(row[0] if row else None)
    # ClinePass: the gateway's generic /models listing omits every cline-pass/*
    # id, so the public recommended-models catalogue is the only correct source.
    if _is_clinepass(cfg):
        catalogue = _clinepass_catalog()
        if not catalogue:
            raise HTTPException(
                status_code=502,
                detail="ClinePass model catalogue unreachable — retry, or type a model id manually.",
            )
        return {"models": catalogue, "count": len(catalogue), "source": "clinepass"}
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    if not base:
        raise HTTPException(status_code=400, detail="Base URL not set — save the integration first.")
    if not key:
        raise HTTPException(status_code=400, detail="API key not set — save your provider API key first.")
    try:
        r = httpx.get(f"{base}/models", headers={"Authorization": f"Bearer {key}"}, timeout=20)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"provider unreachable: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"provider error {r.status_code}: {r.text[:150]}")
    try:
        data = r.json()
        items = data.get("data", data if isinstance(data, list) else [])
        models = [{"id": m.get("id"), "name": m.get("name") or m.get("id")} for m in items if m.get("id")]
        models.sort(key=lambda m: m["id"].lower())
        return {"models": models, "count": len(models)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"unexpected provider response: {exc}")


# === v0.21.36 — chat attachments ===
# Store uploaded files (images/docs) as bytea rows; the chat message references
# attachment ids so the UI can render previews inline.


# === v0.22.0 — Branding: admin-customizable logo (login + sidebar) ===========
BRANDING_KEY = "branding"
_ALLOWED_MIME = {"image/png": "png", "image/jpeg": "jpg"}
_MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB


@router.get("/branding", response_model=BrandingResponse)
def get_branding() -> dict:
    """PUBLIC (no auth) — the login page needs the logo before any token exists.

    Returns { logo: data-url | None, appName: str | None, updated_at }.
    The data-url embeds the bytes, so the SPA can render it without a separate
    authenticated fetch.
    """
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT value, updated_at FROM system_settings WHERE key = :k"
        ), {"k": BRANDING_KEY}).first()
    val = _json_dict(row[0] if row else None)
    return {
        "logo": val.get("logo") or None,          # data:image/png;base64,...
        "appName": val.get("appName") or None,
        "updated_at": str(row[1]) if row and row[1] else None,
    }


@router.put("/admin/branding/logo")
async def put_branding_logo(
    user: str = Depends(get_current_user),
    file: _UPLOAD_FILE = _FILE(...),
    appName: str = _FORM(None),
) -> dict:
    """ADMIN — upload a logo (multipart form). PNG/JPG <= 2 MB.

    Stored as a base64 data-url in system_settings.branding (replicated with
    the DB; no PVC needed). Remove with DELETE /admin/branding/logo.
    """
    _require_admin(user)
    import base64 as _b64

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > _MAX_LOGO_BYTES:
        raise HTTPException(status_code=413, detail="Logo exceeds 2 MB limit")
    mime = file.content_type or ""
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Only PNG and JPG images are allowed")
    # Magic-byte sniffing (content-type header can lie)
    if mime == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=415, detail="File is not a real PNG")
    if mime == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=415, detail="File is not a real JPEG")

    data_url = f"data:{mime};base64," + _b64.b64encode(data).decode()
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = _json_dict(row[0] if row else None)
        cur["logo"] = data_url
        if appName is not None:
            cur["appName"] = str(appName).strip() or None
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": json.dumps(cur)})
        s.commit()
    audit("branding.logo.update", user, detail=f"mime={mime} bytes={len(data)}")
    return {"ok": True, "bytes": len(data), "mime": mime, "appName": cur.get("appName")}


@router.put("/admin/branding/app-name")
def put_branding_app_name(
    body: dict,
    user: str = Depends(get_current_user),
) -> dict:
    """ADMIN — set the brand name (optional) shown beside the logo.

    Body: {"appName": "My IT Help" | null}
    Empty string clears the override, and the installation falls back to its neutral
    built-in name — no product name is baked into the UI.
    """
    _require_admin(user)
    name = body.get("appName")
    name = str(name).strip() if name is not None else None
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = _json_dict(row[0] if row else None)
        if name:
            cur["appName"] = name[:48]  # cap length (the field caps at 48 too)
        else:
            cur.pop("appName", None)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": json.dumps(cur)})
        s.commit()
    audit("branding.appname.update", user, detail=f"appName={name or '(reset)'}")
    return {"ok": True, "appName": cur.get("appName")}


@router.delete("/admin/branding/logo")
def delete_branding_logo(user: str = Depends(get_current_user)) -> dict:
    """ADMIN — reset to the default built-in ITH mark."""
    _require_admin(user)
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t("SELECT value FROM system_settings WHERE key = :k"),
                        {"k": BRANDING_KEY}).first()
        cur = _json_dict(row[0] if row else None)
        cur.pop("logo", None)
        s.execute(_t(
            "INSERT INTO system_settings (key, value, updated_at) VALUES (:k, :v, NOW()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()"
        ), {"k": BRANDING_KEY, "v": json.dumps(cur)})
        s.commit()
    audit("branding.logo.reset", user)
    return {"ok": True}
@router.get("/settings/integrations/jira/service-desks")
def jira_service_desks(user: str = Depends(require_role("admin"))) -> dict:
    """JSM service desks the configured account can see — so the ID can be copied, not guessed."""
    from app.integrations.jira import service_desks

    try:
        return {"desks": service_desks()}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc


@router.get("/settings/integrations/jira/service-desks/{desk_id}/request-types")
def jira_request_types(desk_id: str, user: str = Depends(require_role("admin"))) -> dict:
    """Request types for one service desk — the numbers that go into the JSON map."""
    from app.integrations.jira import request_types

    if not desk_id.isdigit():
        raise HTTPException(status_code=400, detail="desk_id must be numeric")
    try:
        return {"request_types": request_types(desk_id)}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{type(exc).__name__}: {exc}") from exc
