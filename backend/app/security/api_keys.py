"""API Key authentication & management (v1.1.8).

External integrations authenticate with `Authorization: Bearer ith_xxx…` —
same RBAC-enforced chat pipeline, no interactive login. Keys are stored
hashed; the raw key is shown exactly once at creation.

Scopes:
  chat      — POST /api/chat/stream + conversation read endpoints
  readonly  — conversation/KB read endpoints only

Rate limits: per-key 'chat' tier (5/min) applies automatically via the same
Redis limiter used for users.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, UTC

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.auth.rbac import require_cap
from app.persistence.database import SessionLocal
from app.persistence.models import ApiKey
from app.security.rate_limit import check_limit, _too_many

logger = logging.getLogger("apikeys")
router = APIRouter(prefix="/api/apikeys")


def _hash(raw: str) -> str:
    return __import__("hashlib").sha256(raw.encode()).hexdigest()


def generate_key() -> tuple[str, str, str]:
    """Returns (raw_key, key_hash, prefix). Raw shown once; store hash only."""
    raw = "ith_" + secrets.token_urlsafe(24)
    prefix = raw[:12] + "…"
    return raw, _hash(raw), prefix


def authenticate_api_key(raw: str) -> tuple[str, str] | None:
    """Resolve a raw key to (name, scope). None when unknown/inactive."""
    if not raw or not raw.startswith("ith_"):
        return None
    with SessionLocal() as s:
        row = s.query(ApiKey).filter(ApiKey.key_hash == _hash(raw), ApiKey.active == True).first()
        if row is None:
            return None
        row.last_used_at = datetime.now(UTC)
        s.commit()
        return row.name, row.scope


# ---------------------------------------------------------------------------
# Auth dependency: accepts API key OR falls through to normal JWT
# ---------------------------------------------------------------------------

async def get_caller(request: Request) -> dict:
    """Resolve caller as either an API key (X-API-Key / Bearer ith_) or a JWT user."""
    auth = request.headers.get("authorization", "")
    xkey = request.headers.get("x-api-key", "")
    raw = xkey or (auth.split(" ", 1)[1] if auth.lower().startswith("bearer ith_") else "")
    if raw:
        info = authenticate_api_key(raw)
        if info is None:
            raise HTTPException(status_code=401, detail="Invalid API key")
        name, scope = info
        return {"kind": "apikey", "name": name, "scope": scope}
    return {"kind": "jwt"}  # normal path handled by get_current_user


# ---------------------------------------------------------------------------
# Admin management endpoints (manage_users capability)
# ---------------------------------------------------------------------------

@router.get("")
def list_keys(user: str = Depends(get_current_user)) -> dict:
    """v1.1.9 — RBAC: admins see ALL keys; regular users see only their own."""
    from app.auth.rbac import get_role
    role = get_role(user)
    is_admin = role in ("admin", "administrator", "Administrator")
    with SessionLocal() as s:
        q = s.query(ApiKey).order_by(ApiKey.created_at.desc())
        if not is_admin:
            q = q.filter(ApiKey.owner == user)
        rows = q.all()
        return {"keys": [
            {
                "id": r.id, "name": r.name, "key_prefix": r.key_prefix,
                "scope": r.scope, "owner": r.owner, "active": r.active,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "last_used_at": r.last_used_at.isoformat() if r.last_used_at else None,
            } for r in rows
        ]}


@router.post("")
def create_key(body: dict, user: str = Depends(get_current_user)) -> dict:
    """v1.1.9 — every authenticated user may create keys for themselves;
    admins may create on behalf of anyone (optional 'owner' in body)."""
    from app.auth.rbac import get_role
    role = get_role(user)
    is_admin = role in ("admin", "administrator", "Administrator")
    owner = body.get("owner") if (is_admin and body.get("owner")) else user
    name = (body.get("name") or "").strip()[:120]
    scope = body.get("scope", "chat")
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if scope not in ("chat", "readonly"):
        raise HTTPException(status_code=400, detail="scope must be 'chat' or 'readonly'")
    raw, key_hash, prefix = generate_key()
    with SessionLocal() as s:
        k = ApiKey(name=name, key_hash=key_hash, key_prefix=prefix,
                   scope=scope, owner=owner, active=True)
        s.add(k)
        s.commit()
    # audit
    try:
        from app.observability.audit import audit
        audit("apikey.create", user, detail=f"{name} scope={scope} owner={owner}")
    except Exception:
        pass
    return {
        "name": name, "scope": scope, "key_prefix": prefix, "owner": owner,
        "key": raw,  # shown ONCE
        "note": "Store this key securely — it cannot be retrieved again.",
    }


@router.delete("/{key_id}")
def revoke_key(key_id: int, user: str = Depends(get_current_user)) -> dict:
    """RBAC: admins revoke any key; users revoke only their own."""
    from app.auth.rbac import get_role
    role = get_role(user)
    is_admin = role in ("admin", "administrator", "Administrator")
    with SessionLocal() as s:
        row = s.query(ApiKey).filter(ApiKey.id == key_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Key not found")
        if not is_admin and row.owner != user:
            raise HTTPException(status_code=403, detail="You can only revoke your own keys")
        row.active = False
        s.commit()
    from app.observability.audit import audit
    audit("apikey.revoke", user, detail=row.name)
    return {"status": "revoked", "name": row.name}


@router.delete("/{key_id}/purge")
def purge_key(key_id: int, user: str = Depends(get_current_user)) -> dict:
    """v1.3.5 — PERMANENT DELETE of a revoked key (must be inactive first).

    Security best practice: revoked keys can be purged to remove their audit
    surface entirely — the row disappears from the list forever. Admins may
    purge any revoked key; users may purge their own revoked keys.
    """
    from app.auth.rbac import get_role
    role = get_role(user)
    is_admin = role in ("admin", "administrator", "Administrator")
    with SessionLocal() as s:
        row = s.query(ApiKey).filter(ApiKey.id == key_id).first()
        if row is None:
            raise HTTPException(status_code=404, detail="Key not found")
        if not is_admin and row.owner != user:
            raise HTTPException(status_code=403, detail="You can only delete your own keys")
        if row.active:
            raise HTTPException(status_code=400,
                                detail="Revoke the key first — active keys cannot be purged")
        name = row.name
        s.delete(row)
        s.commit()
    from app.observability.audit import audit
    audit("apikey.purge", user, detail=name)
    return {"status": "deleted", "name": name}