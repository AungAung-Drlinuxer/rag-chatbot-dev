"""OIDC single sign-on against Keycloak — authorization code flow with PKCE.

Why this exists: the Keycloak panel could store an issuer, realm and client secret, and
`Test connection` could reach the realm's discovery document, but there was no login path at
all — the login page always posted a username and password. This module is that path.

Flow (all server-side, tokens never touch the browser URL):

    GET /api/auth/sso/login
        → state + nonce + PKCE verifier are remembered, browser is sent to Keycloak
    GET /api/auth/sso/callback?code&state
        → code is exchanged, the id_token is verified against the realm JWKS,
          the user is provisioned, and a one-time code is handed to the SPA
    POST /api/auth/sso/exchange {code}
        → the app's own access/refresh tokens

Design notes:

* `state` and the one-time code live in process memory with a short TTL. That is correct for
  the single-replica deployment this runs as; a multi-replica rollout needs either sticky
  sessions or a shared store (the call sites are small: `_remember`/`_take`).
* The user is NOT logged in on the strength of a callback alone: signature, issuer,
  audience, expiry and nonce are all checked against the realm's JWKS.
* Provisioning mirrors the LDAP path — a first-time identity is created as `Pending` and an
  administrator approves it on the Users page. SSO proves who someone is; it does not grant
  them a workspace seat.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import time
from urllib.parse import urlencode, urlparse

from jose import jwk, jwt
from jose.exceptions import JWTError

from app.config import SETTINGS

logger = logging.getLogger("auth.sso")

_STATE_TTL = 600          # a login attempt must finish within 10 minutes
_CODE_TTL = 60            # SPA has one minute to exchange its one-time code
_DISC_TTL = 300
_STATES: dict[str, dict] = {}
_CODES: dict[str, dict] = {}
_DISCOVERY: dict[str, tuple[float, dict]] = {}
_JWKS: dict[str, tuple[float, list]] = {}


# ── configuration ────────────────────────────────────────────────────────────
def sso_cfg() -> dict:
    """Keycloak settings — saved UI values first, environment second."""
    out = {
        "issuer": SETTINGS.keycloak_issuer,
        "realm": SETTINGS.keycloak_realm,
        "client_id": SETTINGS.keycloak_client_id,
        "client_secret": SETTINGS.keycloak_client_secret,
        "redirect_uri": SETTINGS.keycloak_redirect_uri,
    }
    try:
        import json

        from sqlalchemy import text

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(text("SELECT value FROM system_settings WHERE key = 'keycloak'")).first()
        val = row[0] if row else {}
        if isinstance(val, str):
            val = json.loads(val)
        val = val or {}
        if val.get("base_url") and not val.get("issuer"):
            val["issuer"] = val["base_url"]
        for field in ("issuer", "realm", "client_id", "client_secret", "redirect_uri"):
            if val.get(field):
                out[field] = val[field]
    except Exception as exc:  # DB not ready — env fallback keeps dev runs working
        logger.debug("keycloak settings lookup skipped: %s", exc)
    return {k: (v or "").strip() if isinstance(v, str) else v for k, v in out.items()}


def enabled() -> bool:
    cfg = sso_cfg()
    return all(cfg.get(k) for k in ("issuer", "realm", "client_id", "redirect_uri"))


def _issuer_base(cfg: dict) -> str:
    """Issuer without a trailing `/realms/<realm>` — admins paste either form."""
    issuer = cfg["issuer"].rstrip("/")
    marker = "/realms/"
    if marker in issuer:
        return issuer.split(marker, 1)[0]
    return issuer


def realm_issuer(cfg: dict) -> str:
    return f"{_issuer_base(cfg)}/realms/{cfg['realm']}"


def discovery(cfg: dict) -> dict:
    """Realm discovery document, cached for five minutes."""
    url = f"{realm_issuer(cfg)}/.well-known/openid-configuration"
    hit = _DISCOVERY.get(url)
    if hit and (time.time() - hit[0]) < _DISC_TTL:
        return hit[1]
    import httpx

    r = httpx.get(url, timeout=15)
    r.raise_for_status()
    doc = r.json()
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not doc.get(key):
            raise RuntimeError(f"realm discovery is missing {key}")
    _DISCOVERY[url] = (time.time(), doc)
    return doc


def reload_sso_cfg() -> None:
    _DISCOVERY.clear()
    _JWKS.clear()


# ── state / one-time codes (process memory) ──────────────────────────────────
def _gc() -> None:
    now = time.time()
    for store in (_STATES, _CODES):
        for key in [k for k, v in store.items() if v["exp"] < now]:
            store.pop(key, None)


def _remember(url: str, **payload) -> str:
    _gc()
    state = secrets.token_urlsafe(32)
    _STATES[state] = {"exp": time.time() + _STATE_TTL, "url": url, **payload}
    return state


def take_state(state: str) -> dict:
    """Pop a login attempt. Unknown/expired/reused states are rejected."""
    _gc()
    entry = _STATES.pop(state or "", None)
    if not entry:
        raise ValueError("unknown or expired state — start the sign-in again")
    return entry


def issue_code(username: str) -> str:
    _gc()
    code = secrets.token_urlsafe(32)
    _CODES[code] = {"exp": time.time() + _CODE_TTL, "username": username}
    return code


def redeem_code(code: str) -> str:
    _gc()
    entry = _CODES.pop(code or "", None)
    if not entry:
        raise ValueError("unknown or expired sign-in code")
    return entry["username"]


# ── protocol helpers ─────────────────────────────────────────────────────────
def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def pkce_pair() -> tuple[str, str]:
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def start_login() -> str:
    """Build the authorization URL and remember the attempt."""
    cfg = sso_cfg()
    if not enabled():
        raise RuntimeError("single sign-on is not configured")
    doc = discovery(cfg)
    verifier, challenge = pkce_pair()
    nonce = secrets.token_urlsafe(24)
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"],
        "scope": "openid profile email",
        "state": "pending",
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    # `state` must be ours, so it is generated after the rest of the payload is fixed.
    state = _remember(
        url=doc["authorization_endpoint"],
        nonce=nonce,
        verifier=verifier,
        redirect_uri=cfg["redirect_uri"],
    )
    params["state"] = state
    sep = "&" if "?" in doc["authorization_endpoint"] else "?"
    return f"{doc['authorization_endpoint']}{sep}{urlencode(params)}"


def exchange_code(code: str, verifier: str, redirect_uri: str) -> dict:
    cfg = sso_cfg()
    doc = discovery(cfg)
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": cfg["client_id"],
        "code_verifier": verifier,
    }
    if cfg.get("client_secret"):
        data["client_secret"] = cfg["client_secret"]
    import httpx

    r = httpx.post(doc["token_endpoint"], data=data, timeout=20)
    if r.status_code >= 400:
        raise RuntimeError(f"token endpoint returned {r.status_code}: {r.text[:200]}")
    tokens = r.json()
    if not tokens.get("id_token"):
        raise RuntimeError("token response has no id_token — enable the 'openid' scope on the client")
    return tokens


def _signing_keys(jwks_uri: str) -> list:
    hit = _JWKS.get(jwks_uri)
    if hit and (time.time() - hit[0]) < _DISC_TTL:
        return hit[1]
    import httpx

    r = httpx.get(jwks_uri, timeout=15)
    r.raise_for_status()
    keys = r.json().get("keys", [])
    _JWKS[jwks_uri] = (time.time(), keys)
    return keys


def verify_id_token(id_token: str, nonce: str) -> dict:
    """Verify signature, issuer, audience, lifetime and nonce; return the claims."""
    cfg = sso_cfg()
    doc = discovery(cfg)
    header = jwt.get_unverified_header(id_token)
    kid = header.get("kid")
    candidates = [k for k in _signing_keys(doc["jwks_uri"]) if not kid or k.get("kid") == kid]
    if not candidates:
        # Key rotation: refetch once before giving up.
        _JWKS.pop(doc["jwks_uri"], None)
        candidates = [k for k in _signing_keys(doc["jwks_uri"]) if not kid or k.get("kid") == kid]
    last: Exception | None = None
    for candidate in candidates:
        try:
            key = jwk.construct(candidate, header.get("alg", "RS256"))
            claims = jwt.decode(
                id_token,
                key,
                algorithms=[header.get("alg", "RS256")],
                audience=cfg["client_id"],
                issuer=realm_issuer(cfg),
                options={"verify_at_hash": False},
            )
            break
        except JWTError as exc:
            last = exc
    else:
        raise ValueError(f"id_token failed verification: {last}")
    if nonce and claims.get("nonce") != nonce:
        raise ValueError("id_token nonce does not match this sign-in attempt")
    return claims


def username_from(claims: dict) -> str:
    for field in ("preferred_username", "email", "sub"):
        value = (claims.get(field) or "").strip()
        if value:
            return value.split("@")[0] if field == "email" else value
    raise ValueError("id_token carries no usable identity claim")


def role_from_claims(claims: dict) -> str | None:
    """Map realm groups/roles onto the app's three roles, using the RBAC group lists."""
    groups = set()
    for field in ("groups", "roles"):
        groups.update(str(g) for g in (claims.get(field) or []))
    realm_access = claims.get("realm_access") or {}
    groups.update(str(g) for g in (realm_access.get("roles") or []))
    admins = {g.strip() for g in SETTINGS.rbac_admin_groups.split(",") if g.strip()}
    agents = {g.strip() for g in SETTINGS.rbac_agent_groups.split(",") if g.strip()}
    if groups & admins:
        return "admin"
    if groups & agents:
        return "knowledge"
    return None


def frontend_origin() -> str:
    """Where the SPA lives — derived from the configured callback URL."""
    uri = sso_cfg().get("redirect_uri") or ""
    parts = urlparse(uri)
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else ""


# ── provisioning ─────────────────────────────────────────────────────────────
def provision(username: str, role: str | None) -> str:
    """Return `ok`, `pending` or `disabled` for this identity (mirrors the LDAP gate)."""
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        row = s.execute(
            text("SELECT status, role_override FROM users WHERE username = :u"), {"u": username}
        ).first()
        if row and row.status == "Disabled":
            return "disabled"
        if row and row.status == "Pending":
            return "pending"
        if not row:
            s.execute(
                text(
                    "INSERT INTO users (username, status, last_seen) VALUES (:u, 'Pending', NOW()) "
                    "ON CONFLICT (username) DO NOTHING"
                ),
                {"u": username},
            )
            s.commit()
            return "pending"
        updates = {"u": username}
        sql = "UPDATE users SET last_seen = NOW()"
        if role and not row.role_override:
            sql += ", role_override = :role"
            updates["role"] = role
        s.execute(text(sql + " WHERE username = :u"), updates)
        s.commit()
    return "ok"


def allowed_redirect(origin: str) -> bool:
    """Only bounce back to the SPA the callback URL belongs to (no open redirects)."""
    return bool(origin) and origin == frontend_origin()


def debug_enabled() -> bool:
    return os.environ.get("SSO_DEBUG") == "1"
