"""RBAC / ACL (Phase 9) — LDAP group roles · domain-scoped access · per-domain Jira routing.

Role resolution: LDAP groups → role (admin / agent / user); a dev fallback maps certain
usernames (e.g. `dev`) to admin so the whole flow stays testable without a directory.
"""
from __future__ import annotations

import logging
import time

from fastapi import Depends, HTTPException, status

from app.auth.deps import get_current_user
from app.config import SETTINGS

logger = logging.getLogger("rbac")

ROLES = ("admin", "agent", "user", "knowledge")  # v1.1.1: domain_manager merged into knowledge


def get_groups(username: str) -> list[str]:
    """LDAP group memberships (Phase 9). Empty when no directory configured.

    Reads the same resolved config as login (`ldap_cfg()`), so a directory saved in
    Settings → Integrations governs both the bind and the role lookup.
    """
    from app.auth.ldap_auth import ldap_cfg

    cfg = ldap_cfg()
    if not cfg.get("url"):
        return []
    try:
        from ldap3 import ALL, Connection, Server

        server = Server(cfg["url"], get_info=ALL, connect_timeout=5)
        conn = Connection(server, user=cfg.get("bind_dn") or None,
                          password=cfg.get("bind_password") or None, auto_bind=True)
        conn.search(cfg.get("base_dn") or "",
                    (cfg.get("user_filter") or SETTINGS.ldap_user_filter).format(username=username),
                    attributes=["memberOf"])
        member_of = (conn.entries[0].memberOf.value if conn.entries and hasattr(conn.entries[0].memberOf, "value") else "")
        return [g.split(",")[0].replace("CN=", "") for g in (member_of or "").split(",") if g]
    except Exception:
        return []


def get_role(username: str) -> str:
    """Resolve role for a username (admin > agent > user).

    v0.21.57 — an admin-set `role_override` in the users table wins over LDAP
    groups, so the RBAC matrix + page gating follow what the admin assigned in
    the Users page. Falls back to LDAP-group resolution when there is no row or
    override (never breaks login when the DB is unreachable).
    """
    if not SETTINGS.rbac_enabled:
        return "admin"
    if username in {u.strip() for u in SETTINGS.dev_admin_usernames.split(",") if u.strip()}:
        return "admin"
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT role_override FROM users WHERE username = :u"), {"u": username}
            ).first()
        if row and row.role_override:
            return row.role_override
    except Exception as exc:
        # Fail safe, but never silently: a DB outage here silently downgrades a
        # user to group-derived roles, which looks like a permissions bug with
        # no trace. The fallback stays (login must not break), the silence does not.
        logger.warning("role_override lookup failed for %s, falling back to groups: %s",
                       username, exc)
    groups = set(get_groups(username))
    if groups & {g.strip() for g in SETTINGS.rbac_admin_groups.split(",") if g.strip()}:
        return "admin"
    if groups & {g.strip() for g in SETTINGS.rbac_agent_groups.split(",") if g.strip()}:
        return "agent"
    return "user"


def _parse_role_domains() -> dict[str, set[str]]:
    """'role=domains;role2=domains2' → {role: {'a', ...}} ('*' → all)."""
    out: dict[str, set[str]] = {}
    for chunk in SETTINGS.role_domains.split(";"):
        if "=" not in chunk:
            continue
        role, domains = chunk.split("=", 1)
        out[role.strip()] = {d.strip() for d in domains.split(",") if d.strip()}
    return out


def allowed_domains(role: str) -> set[str] | None:
    """Domains a role may access; None = all (admin / '*')."""
    if role == "admin":
        return None
    mapping = _parse_role_domains()
    domains = mapping.get(role, set())
    if "*" in domains:
        return None
    return domains


def require_role(*roles: str):
    """FastAPI dependency factory — returns the role or 403 if the user lacks one."""
    _ROLE_LABEL = {"admin": "Administrator", "agent": "IT Support",
                   "knowledge": "Knowledge Manager", "user": "User"}

    def dependency(user: str = Depends(get_current_user)) -> str:
        role = get_role(user)  # already override-aware (v0.21.57)
        if role not in roles:
            need = "/".join(_ROLE_LABEL.get(r, r) for r in roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role ({_ROLE_LABEL.get(role, role)}) cannot do this — requires {need}. Please contact your administrator.",
            )
        return role

    return dependency


def jira_route(domain: str | None) -> dict:
    """Per-domain Jira routing: domain → {project, assignee}.

    P4 — the admin edits `jira_project` / `jira_assignee` per domain in the
    Knowledge page's "Domains & Routing Engine", but this function only read the
    `DOMAIN_JIRA_ROUTING` env string, which was empty — so those fields were a
    silent no-op and every ticket went to the global default. Verified live before
    the fix: DOMAIN_JIRA_ROUTING was unset while all 11 domains advertised
    jira_project=ITHD.

    Resolution order:
      1. `DOMAIN_JIRA_ROUTING` env (an explicit operator override, unchanged)
      2. the domain's DB row from classifier_domains (what the UI edits)
      3. nothing — the caller's global default applies
    """
    d = (domain or "").strip().lower()

    # 1) explicit env override
    project, assignee = None, None
    for chunk in SETTINGS.domain_jira_routing.split(";"):
        if "=" not in chunk:
            continue
        key, rest = chunk.split("=", 1)
        if key.strip() == d:
            parts = [p.strip() for p in rest.split(",")]
            project = parts[0] if len(parts) > 0 else None
            assignee = parts[1] if len(parts) > 1 else None
            break
    if project:
        return {"project": project, "assignee": assignee}

    # 2) the admin-managed per-domain row
    if d:
        try:
            for row in _domain_routing_map().get(d, []):
                return {"project": row[0], "assignee": row[1]}
        except Exception as _exc:
            logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"project": None, "assignee": None}


_DOMAIN_ROUTE_CACHE: dict[str, object] = {"at": 0.0, "data": {}}
_DOMAIN_ROUTE_TTL = 60.0


def _domain_routing_map() -> dict:
    """domain_key → [(project, assignee)] from classifier_domains, cached 60s."""
    now = time.time()
    cached = _DOMAIN_ROUTE_CACHE
    if cached["data"] and (now - float(cached["at"])) < _DOMAIN_ROUTE_TTL:
        return cached["data"]  # type: ignore[return-value]

    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    out: dict = {}
    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT domain_key, jira_project, jira_assignee FROM classifier_domains "
            "WHERE is_active = true AND jira_project IS NOT NULL AND jira_project <> ''"
        )).fetchall()
    for key, proj, asg in rows:
        out.setdefault((key or "").lower(), []).append((proj, asg))
    cached["at"], cached["data"] = now, out
    return out


# --- v0.21.57 — effective role (role_override aware) + capability enforcement -----

# Canonical capability ids shown in the admin RBAC matrix.
CAPABILITIES = {
    "chatbot": "Ask the AI assistant",
    "kb_search": "Search knowledge base",
    "create_tickets": "Create & escalate tickets",
    "manage_kb": "Manage knowledge base (sync, write-back)",
    "manage_users": "Manage users, roles & settings",
    "manage_domains": "Manage routing domains & classifier keywords",
}

# v1.1.1 — Knowledge Manager & Domain Manager merged into ONE role:
# the Knowledge page hosts BOTH article management (manage_kb) and the
# Domains & Routing engine (manage_domains), so a single "Knowledge Manager"
# role owns both capabilities. Legacy `domain_manager` values are mapped to
# the same matrix row for backward compatibility.
_MATRIX_ROLE_FOR = {
    "admin": "Administrator",
    "agent": "IT Support",
    "knowledge": "Knowledge Manager",
    "domain_manager": "Knowledge Manager",  # legacy alias — merged role
    "user": "User",
}

_DEFAULT_MATRIX = {
    "Administrator": {"chatbot": True, "kb_search": True, "create_tickets": True, "manage_kb": True, "manage_users": True, "manage_domains": True},
    "IT Support": {"chatbot": True, "kb_search": True, "create_tickets": True, "manage_kb": False, "manage_users": False, "manage_domains": False},
    "Knowledge Manager": {"chatbot": True, "kb_search": True, "create_tickets": False, "manage_kb": True, "manage_users": False, "manage_domains": True},
    "User": {"chatbot": True, "kb_search": True, "create_tickets": False, "manage_kb": False, "manage_users": False, "manage_domains": False},
}


def effective_role(username: str) -> str:
    """role_override from the users table wins; otherwise LDAP-group role.

    Fast path: no LDAP round-trip when an override exists.
    """
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT role_override, status FROM users WHERE username = :u"),
                {"u": username},
            ).first()
        if row and row.role_override:
            return row.role_override
    except Exception as exc:
        logger.warning("effective-role override lookup failed for %s: %s", username, exc)
    return get_role(username)


def _stored_matrix() -> dict:
    """Admin-editable matrix from the rbac_matrix table (merged over defaults)."""
    matrix = {r: dict(p) for r, p in _DEFAULT_MATRIX.items()}
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            rows = s.execute(_t("SELECT role, permissions FROM rbac_matrix")).mappings().all()
        for r in rows:
            perms = r["permissions"] or {}
            if r["role"] in matrix:
                matrix[r["role"]] = {**matrix[r["role"]], **perms}
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return matrix


def _group_permissions(username: str) -> dict | None:
    """Highest-privilege app_group the user belongs to → its role+extra caps.

    v0.21.58 — groups carry a role and optional extra permissions; a user's
    effective access is the best of (personal role_override, group role)."""
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            rows = s.execute(_t(
                "SELECT g.role, g.permissions FROM app_groups g "
                "JOIN app_group_members m ON m.group_name = g.name "
                "WHERE m.username = :u"
            ), {"u": username}).mappings().all()
    except Exception:
        return None
    if not rows:
        return None
    rank = {"admin": 3, "agent": 2, "knowledge": 2, "domain_manager": 2, "user": 1}  # domain_manager = legacy alias of knowledge
    best = max(rows, key=lambda r: rank.get(r["role"], 1))
    extra = best["permissions"] or {}
    return {"role": best["role"], "extra": extra}


def permissions_for(username: str) -> dict:
    """{capability: bool} — role matrix, raised by group extras, then per-user overrides."""
    role = effective_role(username)
    display = _MATRIX_ROLE_FOR.get(role, "User")
    matrix = _stored_matrix()
    perms = dict(matrix.get(display, matrix["User"]))

    # group extras can raise individual caps
    grp = _group_permissions(username)
    if grp:
        grow = _MATRIX_ROLE_FOR.get(grp["role"], "User")
        gmatrix = _stored_matrix().get(grow, {})
        for k, v in gmatrix.items():
            if v:
                perms[k] = True
        for k, v in grp["extra"].items():
            if v:
                perms[k] = True

    # explicit per-user overrides win
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT permissions FROM user_permission_overrides WHERE username = :u"),
                {"u": username},
            ).first()
        if row and row.permissions:
            for k, v in row.permissions.items():
                perms[k] = bool(v)
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)

    # v1.3.6 — merged capability: "Manage routing domains" follows "Manage knowledge"
    # (both live on the Knowledge page). manage_domains stays defined for backend
    # compatibility but is always equal to manage_kb.
    perms["manage_domains"] = perms.get("manage_kb", False)
    return perms


def is_disabled(username: str) -> bool:
    # v0.21.99 — tolerate the "disabled:<user>" sentinel from ldap_auth.
    if username and username.startswith("disabled:"):
        username = username.split(":", 1)[1]
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT status FROM users WHERE lower(username) = lower(:u)"),
                {"u": username},
            ).first()
        return bool(row and row[0] == "Disabled")
    except Exception:
        return False


def require_cap(capability: str, label: str | None = None):
    """FastAPI dependency factory: gate an endpoint on a capability.

    On failure returns a clear 403 message the UI can show verbatim:
    "Your role (User) does not have permission: Create & escalate tickets."
    """
    from fastapi import Depends as _Depends

    def _dep(user: str = _Depends(get_current_user)) -> str:
        perms = permissions_for(user)
        if not perms.get(capability, False):
            role = _MATRIX_ROLE_FOR.get(effective_role(user), "User")
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Your role ({role}) does not have permission: "
                    f"{label or CAPABILITIES.get(capability, capability)}. "
                    "Please contact your administrator."
                ),
            )
        return user

    return _dep


def require_admin(user: str = Depends(get_current_user)) -> str:
    if effective_role(user) != "admin":
        raise HTTPException(
            status_code=403,
            detail="Administrator permission required: Manage users, roles & settings.",
        )
    return user
