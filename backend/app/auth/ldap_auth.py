"""LDAP/AD authentication (ldap3) → JWT.

Design doc Phase 2 auth: the frontend sends credentials here, this module validates them
against the configured directory, and the caller mints a token.

There is deliberately **no** built-in account and no built-in password. Local logins use
`local_user_credentials` (admin-set, hashed, stored in the database); directory logins use
the LDAP settings saved from Settings → Integrations. An installation with neither simply
cannot log anyone in until an administrator configures it — which is the correct default for
an app that other teams are expected to stand up themselves.
"""
from __future__ import annotations

import logging
import time

from app.config import SETTINGS

logger = logging.getLogger("auth")

_CFG: dict | None = None
_CFG_AT: float = 0.0
_CFG_TTL = 30.0


def _build_url(host: str, port: str | int | None) -> str:
    """Turn the two UI fields into an ldap3 URL, tolerating a fully-formed value.

    Admins paste all of these: `10.10.10.10`, `ldaps://ad.corp.local`,
    `ad.corp.local:636`, and `ad.corp.local` + port `636`. Normalise instead of
    refusing, because the failure mode of a bad URL is "every login 401".
    """
    raw = (host or "").strip().rstrip("/")
    if not raw:
        return ""
    if "://" in raw and ":" in raw.split("://", 1)[1]:
        return raw  # already has scheme + port
    scheme = "ldaps" if raw.startswith("ldaps://") else (
        "ldap" if raw.startswith("ldap://") else ("ldaps" if str(port) == "636" else "ldap"))
    bare = raw.split("://", 1)[1] if "://" in raw else raw
    p = str(port or ("636" if scheme == "ldaps" else "389")).strip()
    return f"{scheme}://{bare}:{p}"


def _db_cfg() -> dict:
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        row = s.execute(text("SELECT value FROM system_settings WHERE key = 'ldap'")).first()
    val = row[0] if row else {}
    if isinstance(val, str):
        import json

        val = json.loads(val)
    return val or {}


def ldap_cfg() -> dict:
    """Directory connection settings — saved UI values first, environment second.

    Before this existed, the LDAP panel wrote to `system_settings` and the login path
    read `SETTINGS` (env) only, so a self-service install could configure a directory,
    see "Test connection" pass, and still fail every login.
    """
    global _CFG, _CFG_AT
    now = time.time()
    if _CFG is not None and (now - _CFG_AT) < _CFG_TTL:
        return _CFG
    out = {
        "url": SETTINGS.ldap_url,
        "base_dn": SETTINGS.ldap_base_dn,
        "bind_dn": SETTINGS.ldap_bind_dn,
        "bind_password": SETTINGS.ldap_bind_password,
        "user_filter": SETTINGS.ldap_user_filter,
        "upn_suffix": SETTINGS.ldap_upn_suffix,
    }
    try:
        val = _db_cfg()
        host = str(val.get("host") or "").strip()
        if host:
            out["url"] = _build_url(host, val.get("port"))
        for field in ("base_dn", "bind_dn", "bind_password", "upn_suffix"):
            if val.get(field):
                out[field] = val[field]
        if val.get("user_filter"):
            out["user_filter"] = val["user_filter"]
    except Exception as exc:  # DB not ready / no table yet — env fallback keeps dev working
        logger.debug("LDAP settings lookup skipped: %s", exc)
    _CFG, _CFG_AT = out, now
    return out


def reload_ldap_cfg() -> None:
    """Drop the cache after Settings → Integrations → LDAP is saved."""
    global _CFG, _CFG_AT
    _CFG, _CFG_AT = None, 0.0


def _upn_suffix() -> str:
    """The domain used for a direct UPN bind.

    Configured value wins; otherwise it is derived from `ldap_base_dn`
    (`dc=example,dc=com` → `example.com`) so a new install does not need a code change.
    """
    cfg = ldap_cfg()
    configured = (cfg.get("upn_suffix") or "").strip().lstrip("@")
    if configured:
        return configured
    parts = [
        p.split("=", 1)[1]
        for p in (cfg.get("base_dn") or "").split(",")
        if p.strip().lower().startswith("dc=")
    ]
    return ".".join(parts)


def authenticate(username: str, password: str) -> str | None:
    """Validate credentials.

    Returns:
      "<username>"          — authenticated OK
      "disabled:<username>" — AD bind succeeded but the account is admin-disabled
      "pending:<username>"  — AD bind OK, awaiting registration approval
      "unknown:<username>"  — no such account anywhere (a typo, usually)
      None                  — wrong credentials / directory error
    """
    if not username or not password:
        return None

    # v0.21.58 — LOCAL user credentials first (admin-set passwords). LDAP users are
    # NOT in this table and continue to AD below.
    try:
        import hashlib
        import hmac as _hmac

        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as _s:
            row = _s.execute(
                _t("SELECT password_hash FROM local_user_credentials WHERE username = :u"),
                {"u": username},
            ).first()
        if row:
            try:
                salt, digest = row.password_hash.split("$", 1)
                ok = _hmac.compare_digest(
                    _hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest(), digest
                )
            except Exception:
                ok = False
            if ok:
                logger.info("local credential login for %s", username)
                return username
            logger.warning("local credential login failed for %s", username)
            return None
    except Exception as _e:
        logger.warning("local credential check skipped: %s", _e)

    if not ldap_cfg().get("url"):
        logger.warning("dev auth failed for %s (ldap not configured)", username)
        return f"unknown:{username}"

    return _ldap_authenticate(username, password)


def _ldap_authenticate(username: str, password: str) -> str | None:
    """Bind to LDAP/AD: service-bind → search user DN → rebind as user (verify password).

    v0.20.9 — resilient bind: if the service bind fails (bad DN format/password), fall
    back to a direct UPN user bind (username@drlinuxer.com style), which AD accepts
    without a prior search. Keeps login working while the service account is sorted out.
    """
    from ldap3 import ALL, Connection, Server

    cfg = ldap_cfg()
    server = Server(cfg["url"], get_info=ALL, connect_timeout=5)
    try:
        # 1) bind as service account to search the directory
        svc = Connection(server, user=cfg.get("bind_dn") or None,
                         password=cfg.get("bind_password") or None, auto_bind=False)
        if svc.bind():
            # v0.21.2: strip a UPN suffix if typed, and match either sAMAccountName
            # or userPrincipalName so both "aungaung" and "AungAung@drlinuxer.com" work.
            base_user = username.split("@")[0]
            user_filter = (
                f"(|(sAMAccountName={base_user})(userPrincipalName={username}))"
                if "@" in username
                else (cfg.get("user_filter") or SETTINGS.ldap_user_filter).format(username=username)
            )
            svc.search(cfg.get("base_dn") or "", user_filter,
                       attributes=["sAMAccountName", "mail", "department",
                                   "userPrincipalName"])
            if not svc.entries:
                # Tell "no such account" apart from "wrong password": a misspelt username
                # otherwise reads as a bad password and the user retries forever.
                logger.warning("LDAP user %s not found", username)
                return f"unknown:{username}"
            entry = svc.entries[0]
            user_dn = entry.entry_dn
            # canonical identity = sAMAccountName (stable for roles/audit)
            canonical = str(entry.sAMAccountName) if entry.sAMAccountName else username
            # 2) rebind as the user to verify the password — try DN first, then UPN
            upn = str(entry.userPrincipalName) if entry.userPrincipalName else None
            bound = False
            for bind_as in (user_dn, upn):
                if not bind_as:
                    continue
                # v0.21.99 — no context manager: `with Connection(...)` raises
                # LDAPBindError on a failed bind, aborting the remaining attempts.
                uc = Connection(server, user=bind_as, password=password, auto_bind=False)
                if uc.bind():
                    bound = True
                    break
            if not bound:
                logger.warning("LDAP user bind failed for %s (52e-style)", username)
                return None
            # v0.21.6 — upsert into the local users table so the user appears in
            # /api/users alongside AD accounts. Role defaults to 'user'; admin/agent
            # promotion happens via the it-help-admins / it-help-agents AD groups.
            # v0.21.7 — admin-controlled status + role_override
            try:
                from sqlalchemy import text as _t

                from app.persistence.database import SessionLocal
                with SessionLocal() as s:
                    row = s.execute(_t(
                        "SELECT role_override, status FROM users WHERE username = :u"
                    ), {"u": canonical}).first()
                    if row and row.status == "Disabled":
                        logger.warning("login blocked for %s (status=Disabled)", canonical)
                        return f"disabled:{canonical}"
                    if row and row.status == "Pending":
                        # v0.21.96 — registration flow: LDAP identity verified but the
                        # account is still awaiting admin approval → clear signal, no token.
                        logger.info("login pending registration approval for %s", canonical)
                        return f"pending:{canonical}"
                    if not row:
                        # v0.21.96 — LDAP integration must NOT auto-add users. First-ever
                        # AD bind creates a Pending stub so admins see the request in the
                        # Users page, but login stays blocked until they approve it.
                        s.execute(_t(
                            "INSERT INTO users (username, ldap_dn, department, status, last_seen) "
                            "VALUES (:u, :dn, :dept, 'Pending', NOW()) "
                            "ON CONFLICT (username) DO NOTHING"
                        ), {"u": canonical, "dn": user_dn,
                            "dept": (str(entry.department) if entry.department else None)})
                        s.commit()
                        logger.info("LDAP first-seen %s → Pending (registration required)", canonical)
                        return f"pending:{canonical}"
                    # Active user — refresh last_seen only (role comes from RBAC groups)
                    s.execute(_t(
                        "UPDATE users SET last_seen = NOW() WHERE username = :u"
                    ), {"u": canonical})
                    s.commit()
            except Exception as _exc:
                logger.debug("users status/role check skipped: %s", _exc)
            return canonical

        # service bind failed — log it, then fall through to UPN direct bind
        logger.warning("LDAP service bind failed (%s); trying UPN user bind",
                       svc.result.get("description"))
    except Exception as exc:
        logger.warning("LDAP service bind error (%s); trying UPN user bind",
                       type(exc).__name__)

    # UPN direct bind — AD resolves username@domain without a search
    _suffix = _upn_suffix()
    upn = f"{username}@{_suffix}" if _suffix else None
    if not upn:
        return None
    try:
        with Connection(server, user=upn, password=password) as uc:
            uc2 = Connection(server, user=upn, password=password, auto_bind=False)
            if uc2.bind():
                logger.info("LDAP UPN bind OK for %s", username)
                # v0.21.96 — registration gate mirrors the search path
                try:
                    from sqlalchemy import text as _t

                    from app.persistence.database import SessionLocal
                    base = username.split("@")[0]
                    with SessionLocal() as s:
                        row = s.execute(_t("SELECT status FROM users WHERE username IN (:a, :b)"),
                                        {"a": base, "b": username}).first()
                        if row and row.status == "Disabled":
                            return f"disabled:{base}"
                        if not row or row.status == "Pending":
                            s.execute(_t(
                                "INSERT INTO users (username, ldap_dn, status, last_seen) "
                                "VALUES (:u, :dn, 'Pending', NOW()) "
                                "ON CONFLICT (username) DO UPDATE SET last_seen = NOW()"
                            ), {"u": base, "dn": None})
                            s.commit()
                            return f"pending:{base}"
                except Exception as exc:
                    # The user is about to be logged in regardless, but without a
                    # users row they are invisible to the approval queue. Log it.
                    logger.warning("could not record pending LDAP user %s: %s", base, exc)
                return username.split("@")[0]
            logger.warning("LDAP UPN bind failed for %s (%s)", username,
                           uc2.result.get("description"))
    except Exception as exc:
        logger.warning("LDAP UPN bind error (%s): %s", type(exc).__name__, exc)
    return None
