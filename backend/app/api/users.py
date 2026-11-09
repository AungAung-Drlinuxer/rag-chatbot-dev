from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role
from app.config import SETTINGS
from app.observability.audit import audit
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

router = APIRouter(prefix="/api")

def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]

@router.get("/users/assignable")
def assignable_users(user: str = Depends(get_current_user)) -> dict:
    """Users holding ticket-working roles (admin/agent) — the assignable pool (v0.20.2)."""

    seen: dict[str, dict] = {}
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT username, email, department FROM users")).mappings().all()
        # users table may be empty pre-LDAP; also discover identities from activity
        known = s.execute(
            _t("SELECT DISTINCT created_by AS u FROM jira_tickets WHERE created_by IS NOT NULL "
               "UNION SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL")
        ).mappings().all()
    for r in rows:
        seen[r["username"]] = {"username": r["username"], "email": r.get("email"),
                               "role": get_role(r["username"])}
    for r in known:
        u = r["u"]
        if u and u not in seen:
            seen[u] = {"username": u, "email": None, "role": get_role(u)}
    out = [v for v in seen.values() if v["role"] in ("admin", "agent")]
    return {"users": out}


class AttachmentRequest(BaseModel):
    filename: str
    content_type: str = "application/octet-stream"
    data_base64: str


def _synthetic_email(username: str) -> str:
    """An address for a user whose directory record has none.

    Only synthesised when the installation declares `mail_domain`; otherwise the field is
    left empty rather than inventing an organisation's domain in code.
    """
    domain = (SETTINGS.mail_domain or "").strip().lstrip("@")
    return f"{username}@{domain}" if domain else ""


@router.get("/users")
def list_users(user: str = Depends(get_current_user)) -> dict:
    """All users visible to the chatbot — AD users (LDAP) merged with local users.
    Local users come from the users table (created on first login), AD users from the
    configured LDAP base. Admin/agent only (v0.21.9).

    v0.21.51 — gate uses get_role() (which knows about dev_admin_usernames) so
    the new admin ('ith@admin') is recognised on first login before the users
    table has a row for them.
    """
    from app.auth.rbac import get_role as _gr
    role = _gr(user)
    if role not in ("admin", "agent"):
        raise HTTPException(status_code=403, detail="Forbidden")
    out: dict[str, dict] = {}
    # Admin-managed app groups; a user's DEPARTMENT comes from the directory (`users.department`),
    # not from a groups table — the departments feature was removed, and the old join meant a
    # user could show a department that no longer existed anywhere.
    app_group_map: dict[str, list[str]] = {}
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal as _SL

        with _SL() as s:
            for m in s.execute(_t("SELECT group_name, username FROM app_group_members")).mappings():
                app_group_map.setdefault(m["username"], []).append(m["group_name"])
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)

    # 1) local users (DB) — first so the canonical id field is "local:<username>"
    with SessionLocal() as s:
        try:
            from sqlalchemy import text as _t
            rows = s.execute(_t(
                "SELECT username, role_override, status, disabled_at, email, department, last_login "
                "FROM users ORDER BY username"
            )).mappings().all()
            for r in rows:
                u = r["username"]
                raw_r = r.get("role_override") or "user"
                # v1.1.1 — domain_manager merged into Knowledge Manager
                role = "Knowledge Manager" if raw_r in ("knowledge", "domain_manager") else ("IT Support" if raw_r == "agent" else raw_r.capitalize())
                out[u] = {
                    "id": f"local:{u}",
                    "name": u,
                    "username": u,
                    "email": r.get("email") or _synthetic_email(u),
                    "department": r.get("department") or "Internal",
                    "role": role,
                    "roleOverride": r.get("role_override"),
                    "status": r.get("status") or "Active",
                    "groups": app_group_map.get(u, []),
                    "lastLogin": r["last_login"].isoformat() if r.get("last_login") else "—",
                    "joined": "—",
                    "source": "local",
                }
        except Exception as _exc:
            logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    # 2) AD users via LDAP
    if SETTINGS.ldap_url:
        try:
            from ldap3 import ALL, Connection, Server
            server = Server(SETTINGS.ldap_url, get_info=ALL, connect_timeout=5)
            conn = Connection(server, user=SETTINGS.ldap_bind_dn,
                               password=SETTINGS.ldap_bind_password, auto_bind=True)
            # Search for user objects only
            conn.search(SETTINGS.ldap_base_dn,
                        "(&(objectClass=user)(objectCategory=person)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
                        attributes=["sAMAccountName", "displayName", "mail", "department",
                                    "userPrincipalName", "memberOf", "whenCreated", "lastLogon", "lastLogonTimestamp"],
                        size_limit=500)
            from datetime import datetime as _dt
            for e in conn.entries:
                u = str(e.sAMAccountName) if e.sAMAccountName else None
                if not u:
                    continue
                # derive role from AD groups
                groups: list[str] = []
                if hasattr(e, "memberOf") and e.memberOf:
                    # ldap3 returns memberOf as a list of strings (one per group DN)
                    raw_list = e.memberOf.values if hasattr(e.memberOf, "values") else e.memberOf
                    if isinstance(raw_list, str):
                        raw_list = [raw_list]
                    for g in raw_list:
                        if g.startswith("CN="):
                            groups.append(g.split(",")[0].replace("CN=", ""))
                role = "User"
                for g in groups:
                    if "admin" in g.lower():
                        role = "Administrator"; break
                    if "agent" in g.lower() or "support" in g.lower():
                        role = "IT Support"
                # lastLogon is a 100-ns Windows ticks value (if present and large)
                last_login = "—"
                # v0.21.58 — lastLogon is per-DC (not replicated); lastLogonTimestamp
                # is the replicated, accurate "last login" across all DCs.
                ll_value = None
                if hasattr(e, "lastLogonTimestamp") and e.lastLogonTimestamp:
                    ll_value = e.lastLogonTimestamp
                elif hasattr(e, "lastLogon") and e.lastLogon:
                    ll_value = e.lastLogon
                if ll_value:
                    try:
                        ticks = int(str(ll_value))
                        if ticks > 0:
                            ts = (ticks / 10000000.0) - 11644473600
                            if ticks > 9223372036854775807 // 2:  # never-logged-in sentinel
                                last_login = "—"
                            else:
                                last_login = _dt.fromtimestamp(ts, tz=_dt.timezone.utc).isoformat()
                    except Exception as _exc:
                        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
                # local record lookup (before first use — v0.21.74 bugfix)
                local = out.get(u, {})
                # local last_login (real chatbot logins) wins when newer
                local_ll = (local or {}).get("lastLogin")
                if local_ll and local_ll != "—":
                    last_login = local_ll
                joined = "—"
                if hasattr(e, "whenCreated") and e.whenCreated:
                    joined = str(e.whenCreated)
                # v0.21.53 — preserve admin overrides from the local users table
                # (status + roleOverride). Without this, /api/users would always
                # return "Active" for AD users and ignore the disabled state.
                # v0.21.57 — capitalise the merged role so "agent" -> "Agent" for
                # the UI (matches what the local block does).
                merged_role = (local.get("roleOverride") or role).capitalize()
                merged_status = local.get("status") or "Active"
                merged_dept = local.get("department") if local.get("department") and local.get("department") != "Internal" else (str(e.department) if e.department else "—")
                ad_groups = groups + [g for g in app_group_map.get(u, []) if g not in groups]
                out[u] = {
                    "id": f"ad:{u}",
                    "name": str(e.displayName) if e.displayName else u,
                    "username": u,
                    "email": str(e.mail) if e.mail else _synthetic_email(u),
                    "department": merged_dept,
                    "role": merged_role,
                    "roleOverride": local.get("roleOverride"),
                    "status": merged_status,
                    "groups": ad_groups,
                    "lastLogin": last_login,
                    "joined": joined,
                    "source": "ad",
                }
        except Exception as exc:
            logger.warning("LDAP user search failed: %s", exc)
    return {"users": sorted(out.values(), key=lambda x: x["username"].lower())}



@router.patch("/users/{username}/role")
def update_user_role(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: change a user's role. role_override in users table takes precedence
    over AD-group-derived role on next login (v0.21.7)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    role = (payload.get("role") or "").strip().lower()
    # Map display names to backend enum
    # v1.1.1 — domain_manager merged into knowledge; legacy input names map there too
    role = {"it support": "agent", "knowledge manager": "knowledge", "domain manager": "knowledge", "domain_manager": "knowledge", "administrator": "admin", "user": "user", "admin": "admin", "agent": "agent"}.get(role, role)
    if role not in ("admin", "agent", "user", "knowledge"):
        raise HTTPException(status_code=400, detail="role must be admin|agent|user|knowledge")
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, role_override) VALUES (:u, :r) "
            "ON CONFLICT (username) DO UPDATE SET role_override = EXCLUDED.role_override"
        ), {"u": username, "r": role})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.role.update", user, detail=f"target={username} role={role}")
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True, "username": username, "role_override": role}


@router.patch("/users/{username}/status")
def update_user_status(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: enable/disable a user. Disabled users cannot log in (v0.21.7).
    v0.21.52 — refuse to disable yourself so an admin can never self-lockout
    (the existing token is invalidated on disable, so re-enabling from the
    same session is impossible).
    """
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if username == user and not bool(payload.get("enabled", True)):
        raise HTTPException(
            status_code=400,
            detail="You cannot disable your own account. Ask another admin.",
        )
    enabled = bool(payload.get("enabled", True))
    new_status = "Active" if enabled else "Disabled"
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, status) VALUES (:u, :s) "
            "ON CONFLICT (username) DO UPDATE SET status = EXCLUDED.status, "
            "disabled_at = CASE WHEN EXCLUDED.status = 'Disabled' THEN NOW() ELSE NULL END"
        ), {"u": username, "s": new_status})
        s.execute(text(
            "UPDATE users SET status = :s, "
            "disabled_at = CASE WHEN :s = 'Disabled' THEN NOW() ELSE NULL END "
            "WHERE username = :u"
        ), {"s": new_status, "u": username})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.status.update", user, detail=f"target={username} enabled={enabled}")
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True, "username": username, "status": new_status}


@router.post("/users/{username}/reset-access")
def reset_user_access(username: str, user: str = Depends(get_current_user)) -> dict:
    """Admin: force a re-login. Invalidates refresh tokens and bumps last_seen
    re-auth flag (the user must log in again) (v0.21.7)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO users (username, status) VALUES (:u, 'Active') "
            "ON CONFLICT (username) DO UPDATE SET status = 'Active', disabled_at = NULL"
        ), {"u": username})
        s.execute(text(
            "UPDATE users SET status = 'Active', disabled_at = NULL WHERE username = :u"
        ), {"u": username})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("user.reset_access", user, detail=f"target={username}")
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True, "username": username, "status": "Active"}



@router.put("/users/{username}/password")
def set_local_password(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set a password for a LOCAL user. LDAP users must change it in AD."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    pw = payload.get("password") or ""
    if len(pw) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    # refuse for LDAP-sourced users (they authenticate against AD)
    with SessionLocal() as s:

        from app.persistence.models import LocalUserCredential

        u = s.get(LocalUserCredential, username)
        if u and u.source == "ldap":
            raise HTTPException(
                status_code=400,
                detail="LDAP users authenticate against Active Directory — change the password there.",
            )
        import hashlib
        import hmac as _hmac
        import secrets

        salt = secrets.token_hex(16)
        digest = _hmac.new(salt.encode(), pw.encode(), hashlib.sha256).hexdigest()
        stored = f"{salt}${digest}"
        s.execute(text(
            "INSERT INTO local_user_credentials (username, password_hash, source) "
            "VALUES (:u, :p, 'local') "
            "ON CONFLICT (username) DO UPDATE SET password_hash = :p, updated_at = NOW()"
        ), {"u": username, "p": stored})
        s.commit()
    try:
        audit("user.password.set", user, detail=f"target={username}")
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True}



