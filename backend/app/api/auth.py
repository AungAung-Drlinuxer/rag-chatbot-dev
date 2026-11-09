from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.auth import sso
from app.auth.deps import get_current_user
from app.auth.jwt import create_access_token, create_refresh_token
from app.auth.ldap_auth import authenticate
from app.auth.rbac import require_cap
from app.observability.audit import audit
from app.persistence.models import UserSettings
from app.schemas import LoginRequest, RefreshRequest
from app.security.rate_limit import limit

logger = logging.getLogger("auth")

router = APIRouter()

_require_chatbot = require_cap("chatbot")

@router.post("/api/auth/login")
@limit("login", by_ip=True)
def login(req: LoginRequest, request: Request = None) -> dict:
    """LDAP/AD authenticate (Phase 5) → JWT access + refresh tokens (dev fallback: dev/dev)."""
    subject = authenticate(req.username, req.password)
    if subject and subject.startswith("unknown:"):
        who = subject.split(":", 1)[1]
        logger.info("login refused: no account named %s", who)
        raise HTTPException(
            status_code=401,
            detail=(f"No account named '{who}'. Check the spelling — an administrator "
                    "can see the exact account name on the Users page."),
        )
    if not subject:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # v0.21.99 — admin-disabled accounts get a dedicated 403 (NOT the misleading
    # 401 "Invalid credentials"): AD bind succeeded, so the password was correct —
    # the account itself is blocked.
    if subject.startswith("disabled:"):
        who = subject.split(":", 1)[1]
        logger.warning("login refused: %s is disabled", who)
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    # v0.21.96 — LDAP registration gate: identity verified but account not yet
    # approved by an administrator → complete login is refused with a clear reason.
    if subject.startswith("pending:"):
        who = subject.split(":", 1)[1]
        raise HTTPException(
            status_code=403,
            detail=("Registration pending — your AD account was verified, but an "
                    "administrator must approve it on the Users page before you can "
                    "sign in. (Requested as " + who + ")"),
        )
    # v0.21.57 — hard block at login for admin-disabled users (covers the dev
    # backdoor path too, which bypasses the LDAP upsert check).
    from app.auth.rbac import is_disabled
    if is_disabled(subject):
        logger.warning("login refused: %s is disabled", subject)
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    # v0.21.58 — record the real login time (Users page 'Last login' column)
    try:
        from sqlalchemy import text as _lt

        from app.persistence.database import SessionLocal as _SL

        with _SL() as _s:
            _s.execute(_lt(
                "INSERT INTO users (username, last_login) VALUES (:u, NOW()) "
                "ON CONFLICT (username) DO UPDATE SET last_login = NOW(), last_seen = NOW()"
            ), {"u": subject})
            _s.commit()
    except Exception as _e:
        logger.warning("last_login update skipped: %s", _e)
    audit("login", subject)
    return {
        "access_token": create_access_token(subject),
        "refresh_token": create_refresh_token(subject),
        "token_type": "bearer",
        "username": subject,
    }


@router.post("/api/auth/refresh")
def refresh_token(req: RefreshRequest) -> dict:
    """Exchange a valid refresh token for a new access token (v0.18.1)."""
    from app.auth.jwt import create_access_token, decode_token

    try:
        subject = decode_token(req.refresh_token, expected_type="refresh")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    # v0.21.50 — also block refresh for disabled users
    try:
        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t("SELECT status FROM users WHERE username = :u"), {"u": subject}).first()
        if row and row[0] == "Disabled":
            raise HTTPException(
                status_code=403,
                detail="Account is disabled — please contact your administrator",
            )
    except HTTPException:
        raise
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"access_token": create_access_token(subject), "username": subject}


@router.get("/api/auth/me")
def me(user: str = Depends(get_current_user)) -> dict:
    """Current user + RBAC role (Phase 9) — lets the client show/hide admin UI.

    v0.21.57 — role now honours the admin-set role_override, and we return the
    resolved capability map + display role so the frontend can gate navigation and
    explain *why* something is blocked ("Your role (User) cannot create tickets").
    """
    from app.auth.rbac import (
        _MATRIX_ROLE_FOR,
        CAPABILITIES,
        effective_role,
        permissions_for,
    )

    role = effective_role(user)
    perms = permissions_for(user)
    return {
        "username": user,
        "role": role,
        "displayRole": _MATRIX_ROLE_FOR.get(role, "User"),
        "permissions": perms,
        "capabilityLabels": CAPABILITIES,
    }


# v0.21.57 — capability-gated endpoints give a clear 403 the UI can show
_require_chatbot = require_cap("chatbot")


def _serialize_user_settings(s: UserSettings) -> dict:
    return {
        "username": s.username,
        "theme": s.theme,
        "density": s.density,
        "chat_font_size": s.chat_font_size,
        "code_font": s.code_font,
        "show_token_usage": s.show_token_usage,
        "show_rag_sources": s.show_rag_sources,
        "stream_responses": s.stream_responses,
        "markdown_rendering": s.markdown_rendering,
        "auto_escalate_on_caution": s.auto_escalate_on_caution,
        "history_retention_days": s.history_retention_days,
        "escalate_include_transcript": s.escalate_include_transcript,
        "escalate_include_sources": s.escalate_include_sources,
        "escalate_open_new_tab": s.escalate_open_new_tab,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


_USER_SETTABLE_FIELDS = {
    "theme", "density", "chat_font_size", "code_font",
    "show_token_usage", "show_rag_sources", "stream_responses",
    "markdown_rendering", "auto_escalate_on_caution",
    "history_retention_days",
    "escalate_include_transcript", "escalate_include_sources",
    "escalate_open_new_tab",
}


@router.get("/api/settings")
def get_my_settings(user: str = Depends(get_current_user)) -> dict:
    """Return the current user's preferences (creating the row on first read).

    v0.22.2 — merges the ORM columns (theme, density, …) with the free-form
    `prefs` JSONB blob the SettingsPage saves (darkMode, appName, …). Prefs
    win on conflicts. Previously this endpoint only serialized the ORM columns,
    so the saved darkMode was invisible on session restore and the theme reset
    to light on every relogin.
    """
    import json as _json

    from sqlalchemy import text as _t

    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
            s.commit()
            s.refresh(row)
        out = _serialize_user_settings(row)
        prefs_row = s.execute(
            _t("SELECT prefs FROM user_settings WHERE username = :u"), {"u": user}
        ).first()
        prefs = prefs_row[0] if prefs_row else {}
        if isinstance(prefs, str):
            try:
                prefs = _json.loads(prefs)
            except Exception:
                prefs = {}
        if isinstance(prefs, dict):
            # v0.22.4 — flatten the legacy nested {"settings": {...}} written by
            # the old unwrapped-PUT bug, then merge (inner values win).
            nested = prefs.pop("settings", None)
            if isinstance(nested, dict):
                prefs.update(nested)
            out.update(prefs)  # prefs blob wins over ORM defaults
        return out
    finally:
        s.close()


@router.put("/api/settings")
def update_my_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Merge-update the current user's preferences.

    v0.22.3 — known fields map to ORM columns; EVERYTHING else (darkMode,
    appName, animations, … the SettingsPage's flat prefs) is persisted into
    the `prefs` JSONB blob. Previously the extra keys were silently dropped,
    so a saved "light" theme never stuck and login kept the stale dark theme.
    """
    import json as _json

    from sqlalchemy import text as _t

    from app.persistence.database import SessionLocal

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="payload must be a JSON object")
    # v0.22.4 — the UI (putUserSettings) wraps prefs as {settings: {...}}. Without
    # unwrapping, the whole envelope nested under prefs["settings"] and the
    # top-level darkMode (stale) kept winning on GET merge.
    payload = payload.get("settings") if isinstance(payload.get("settings"), dict) else payload
    s = SessionLocal()
    try:
        row = s.get(UserSettings, user)
        if row is None:
            row = UserSettings(username=user)
            s.add(row)
        extras: dict = {}
        for k, v in payload.items():
            if k in _USER_SETTABLE_FIELDS and v is not None:
                setattr(row, k, v)
            elif v is not None:
                extras[k] = v
        if extras:
            existing = s.execute(
                _t("SELECT prefs FROM user_settings WHERE username = :u"), {"u": user}
            ).first()
            prefs = existing[0] if existing else {}
            if isinstance(prefs, str):
                try:
                    prefs = _json.loads(prefs)
                except Exception:
                    prefs = {}
            prefs = prefs or {}
            prefs.update(extras)
            s.execute(
                _t(
                    "INSERT INTO user_settings (username, theme, density, prefs) "
                    "VALUES (:u, :t, :d, :p) "
                    "ON CONFLICT (username) DO UPDATE SET theme = :t, density = :d, prefs = :p, updated_at = NOW()"
                    ),
                    {"u": user, "t": row.theme or "light", "d": row.density or "comfortable",
                 "p": _json.dumps(prefs)},
            )
        s.commit()
        s.refresh(row)
        out = _serialize_user_settings(row)
        if extras:
            out.update(extras)
        return out
    finally:
        s.close()


# ── OIDC single sign-on (Keycloak) ───────────────────────────────────────────
class SsoExchangeRequest(BaseModel):
    code: str


@router.get("/api/auth/sso/enabled")
def sso_enabled() -> dict:
    """Login page asks this to decide whether to draw the SSO button (no auth)."""
    return {"enabled": sso.enabled()}


@router.get("/api/auth/sso/login")
def sso_login() -> RedirectResponse:
    """Start the authorization-code flow."""
    origin = sso.frontend_origin()
    try:
        return RedirectResponse(sso.start_login(), status_code=302)
    except Exception as exc:
        logger.warning("sso start failed: %s", exc)
        return RedirectResponse(f"{origin}/#/login?sso_error=unavailable", status_code=302)


@router.get("/api/auth/sso/callback")
def sso_callback(
    code: str = "",
    state: str = "",
    error: str = "",
    error_description: str = "",
) -> RedirectResponse:
    """Finish the flow: verify the id_token, provision the user, hand the SPA a code."""
    origin = sso.frontend_origin()

    def bounce(reason: str) -> RedirectResponse:
        return RedirectResponse(f"{origin}/#/login?sso_error={reason}", status_code=302)

    if error:
        logger.warning("sso denied by the identity provider: %s %s", error, error_description[:200])
        return bounce("denied")
    if not code or not state:
        return bounce("invalid")
    try:
        attempt = sso.take_state(state)
        tokens = sso.exchange_code(code, attempt["verifier"], attempt["redirect_uri"])
        claims = sso.verify_id_token(tokens["id_token"], attempt["nonce"])
        username = sso.username_from(claims)
        role = sso.role_from_claims(claims)
        status = sso.provision(username, role)
    except Exception as exc:
        # Never leak the reason to the browser: it can contain token-endpoint output.
        logger.warning("sso callback failed: %s", exc)
        return bounce("failed")

    if status == "disabled":
        return bounce("disabled")
    if status == "pending":
        return bounce("pending")

    audit("login", username, detail="sso")
    return RedirectResponse(f"{origin}/#/sso?code={sso.issue_code(username)}", status_code=302)


@router.post("/api/auth/sso/exchange")
@limit("login", by_ip=True)
def sso_exchange(req: SsoExchangeRequest) -> dict:
    """Trade the one-time code the callback issued for the app's own tokens."""
    try:
        username = sso.redeem_code(req.code)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Sign-in code is invalid or expired") from exc
    from app.auth.rbac import is_disabled

    if is_disabled(username):
        raise HTTPException(
            status_code=403,
            detail="Your account has been disabled by an administrator. Please contact IT.",
        )
    audit("login", username, detail="sso-exchange")
    return {
        "access_token": create_access_token(username),
        "refresh_token": create_refresh_token(username),
        "username": username,
    }
