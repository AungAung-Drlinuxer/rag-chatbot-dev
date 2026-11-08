"""FastAPI dependency — requires a valid JWT Bearer token (Phase 5 auth)."""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import decode_token

_bearer = HTTPBearer(auto_error=False)

UN_AUTHORIZED = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),  # noqa: B008 (FastAPI idiom)
) -> str:
    """Return the authenticated username from the `Authorization: Bearer *** header.

    v1.1.8 — also accepts external API keys (`Bearer ith_…`, managed in
    Settings → API Keys). An API-key caller is represented as
    `apikey:<name>@<scope>` so per-key rate limiting and audit attribution work.
    """
    if credentials is None:
        raise UN_AUTHORIZED
    raw = credentials.credentials
    if raw.startswith("ith_"):
        from app.security.api_keys import authenticate_api_key
        info = authenticate_api_key(raw)
        if info is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        name, scope = info
        if scope != "chat":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="API key scope is read-only")
        return f"apikey:{name}"
    try:
        username = decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    # v0.21.50 — revoke session immediately if admin disabled the user
    try:
        from sqlalchemy import text as _t
        from app.persistence.database import SessionLocal
        with SessionLocal() as s:
            row = s.execute(_t(
                "SELECT status FROM users WHERE username = :u"
            ), {"u": username}).first()
        if row and row[0] == "Disabled":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled — please contact your administrator",
            )
    except HTTPException:
        raise
    except Exception:
        # DB hiccup = fail-open so a transient outage doesn't lock everyone out
        pass
    return username
