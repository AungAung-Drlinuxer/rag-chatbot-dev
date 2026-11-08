"""v0.24.0 — Domain Rename API with transactional cascade.

Renames a domain's `domain_key` across every dependent store in ONE transaction:
  1. classifier_domains.domain_key
  2. kb_meta.domain (bookkeeping)
  3. langchain_pg_embedding.cmetadata{domain} (vector chunks — pgvector store)
Then reloads the classifier cache and writes an audit entry.

The rename is refused for keys that would collide with an existing domain.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth.deps import get_current_user
from app.auth.rbac import require_cap
from app.observability.audit import audit

from sqlalchemy import text as _sqltext

from app.persistence.database import SessionLocal
from app.persistence.models import ClassifierDomain
from app.classifier.engine import reload_rules_cache

router = APIRouter()


class DomainRenameRequest(BaseModel):
    new_domain_key: str = Field(..., min_length=2, max_length=64)


@router.post("/api/admin/domains/{domain_id}/rename")
def rename_domain(
    domain_id: int,
    req: DomainRenameRequest,
    user: str = Depends(require_cap("manage_domains")),
) -> dict:
    """Rename a domain key atomically across classifier config, KB meta, and vector metadata."""
    new_key = req.new_domain_key.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,63}", new_key):
        raise HTTPException(
            status_code=400,
            detail="Domain key must be 2-64 chars: lowercase letters, digits, underscore or hyphen.",
        )

    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")

        old_key = d.domain_key
        if old_key == new_key:
            raise HTTPException(status_code=400, detail="New domain key is identical to the current one.")

        collision = (
            s.query(ClassifierDomain)
            .filter(ClassifierDomain.domain_key == new_key)
            .filter(ClassifierDomain.id != domain_id)
            .first()
        )
        if collision:
            raise HTTPException(
                status_code=400,
                detail=f"Domain key '{new_key}' already exists — choose a unique key.",
            )

        # Protect Confluence space-key domains: renaming them would break the
        # space → domain mapping the loader assumes (space_key.lower()).
        confluence_spaces = {
            sk.strip().lower()
            for sk in __import__("app.config", fromlist=["SETTINGS"]).SETTINGS.confluence_space_keys.split(",")
            if sk.strip()
        }
        if old_key in confluence_spaces:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{old_key}' is bound to a Confluence space key. Rename the "
                    "CONFLUENCE_SPACE_KEYS setting first, then rename this domain."
                ),
            )

        # Single atomic transaction — all three stores or nothing.
        s.execute(
            _sqltext(
                "UPDATE kb_meta SET domain = :new WHERE domain = :old"
            ),
            {"old": old_key, "new": new_key},
        )
        s.execute(
            _sqltext(
                "UPDATE langchain_pg_embedding "
                "SET cmetadata = jsonb_set(cmetadata::jsonb, '{domain}', to_jsonb(CAST(:new AS text))) "
                "WHERE cmetadata->>'domain' = :old"
            ),
            {"old": old_key, "new": new_key},
        )
        d.domain_key = new_key
        s.commit()
        row_count = s.execute(
            _sqltext("SELECT count(*) FROM kb_meta WHERE domain = :k"), {"k": new_key}
        ).scalar()

    reload_rules_cache()
    audit("domain_renamed", user, detail=f"domain {old_key} -> {new_key} ({row_count} KB pages migrated)")
    return {
        "status": "ok",
        "id": domain_id,
        "old_domain_key": old_key,
        "domain_key": new_key,
        "kb_pages_migrated": int(row_count or 0),
    }
