from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.rbac import require_cap, require_role
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.schemas import (
    DomainCreateRequest,
    DomainUpdateRequest,
    EvalCasesResponse,
)

router = APIRouter()

@router.get("/api/admin/settings")
def get_admin_settings(user: str = Depends(get_current_user),
                       role: str = Depends(require_role("admin"))) -> dict:
    """RAG-tuning overrides (admin only). Returns metadata for the UI."""
    from app.runtime import metadata as runtime_metadata
    return {"knobs": runtime_metadata()}


@router.put("/api/admin/settings")
def update_admin_settings(payload: dict, user: str = Depends(get_current_user),
                          role: str = Depends(require_role("admin"))) -> dict:
    """Apply one or more RAG-tuning overrides. Takes effect on the next request."""
    from app.runtime import metadata as runtime_metadata
    from app.runtime import set_ as runtime_set

    if not isinstance(payload, dict) or not isinstance(payload.get("knobs"), dict):
        raise HTTPException(status_code=400, detail="payload must be {\"knobs\": {key: value, ...}}")
    applied = {}
    for k, v in payload["knobs"].items():
        try:
            runtime_set(k, v)
            applied[k] = v
        except KeyError:
            continue  # silently skip non-whitelisted keys
    audit("settings_update", user, detail=f"knobs={list(applied.keys())}")
    return {"applied": applied, "knobs": runtime_metadata()}


@router.delete("/api/admin/settings/{key}")
def reset_admin_setting(key: str, user: str = Depends(get_current_user),
                        role: str = Depends(require_role("admin"))) -> dict:
    """Reset a RAG-tuning override back to the env default."""
    from app.runtime import reset as runtime_reset
    try:
        runtime_reset(key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown key: {key}")
    audit("settings_reset", user, detail=f"key={key}")
    return {"reset": key}


def _mask_url(url: str | None) -> str:
    """Mask any credentials embedded in a connection URL (shared policy)."""
    from app.security.credentials import mask_url_secret

    return mask_url_secret(url)


def _secret_status(value: str | None) -> str:
    """Never expose secret values — only the meta state."""
    if value is None or value == "":
        return "missing"
    if value.startswith("REPLACE_ME"):
        return "placeholder"
    return "set"


@router.get("/api/integrations/status")
def integrations_status(user: str = Depends(get_current_user)) -> dict:
    """Integration status grid for the Settings panel — values never exposed."""
    from app.config import SETTINGS as S
    from app.runtime import metadata as runtime_metadata
    return {
        "llm": {
            "provider": S.hchat_provider,
            "model": S.hchat_model,
            "base_url": S.hchat_base_url,
            "api_key": _secret_status(os.environ.get("H_CHAT_API_KEY") or S.hchat_api_key),
        },
        "ollama": {
            "url": S.ollama_url,
            "embedding_model": S.embedding_model,
            "embedding_dim": S.embedding_dim,
        },
        "postgres": {
            "url": _mask_url(S.database_url),
            "cnpg_cluster": "postgres-ha",
        },
        "redis": {
            # masked: redis_url embeds the live Redis password
            "url": _mask_url(S.redis_url),
            "mode": S.redis_mode,
            "sentinels": S.redis_sentinels,
            "master_name": S.redis_master_name,
            "password": _secret_status(S.redis_password),
        },
        "jira": {
            "base_url": S.jira_base_url,
            "project": S.jira_project,
            "token": _secret_status(os.environ.get("JIRA_TOKEN") or S.jira_token),
            "routing": S.domain_jira_routing,
        },
        "confluence": {
            "base_url": S.confluence_base_url,
            "space_keys": S.confluence_space_keys,
            "token": _secret_status(os.environ.get("CONFLUENCE_TOKEN") or S.confluence_token),
        },
        "ldap": {
            "url": S.ldap_url,
            "base_dn": S.ldap_base_dn,
            "user_filter": S.ldap_user_filter,
            "bind_password": _secret_status(os.environ.get("LDAP_BIND_PASSWORD") or S.ldap_bind_password),
        },
        "observability": {
            "tempo": S.tempo_otlp_url or "not configured",
            "mimir": S.mimir_otlp_url or "not configured",
            "loki": S.loki_url or "not configured",
        },
        "runtime_overrides": runtime_metadata(),
        "app": {
            "version": "0.2.0",
            "env": S.app_env,
            "service": S.service_name,
        },
    }

# --------------------------------------------------------------------------
# Eval harness (admin-only) — scores RAG retrieval + LLM answer quality
#   /api/eval/run   POST  — runs the qa_set.yaml against the live pipeline
# --------------------------------------------------------------------------
from app.eval import run_eval as _run_eval


@router.post("/api/eval/run")
async def eval_run_endpoint(user: str = Depends(get_current_user),
                              role: str = Depends(require_role("admin"))) -> dict:
    """Run the eval harness — admin-only."""
    return await _run_eval()


@router.get("/api/eval", response_model=EvalCasesResponse)
def eval_cases_endpoint(user: str = Depends(get_current_user)) -> dict:
    """Return the eval dataset (no scoring, just questions + expectations)."""
    from app.eval import load_cases
    cases = load_cases()
    return {"n_cases": len(cases),
            "cases": [{"question": c.question, "domain": c.expected_domain,
                       "must_contain": c.answer_must_contain,
                       "expected_sources": c.expected_source_page_ids} for c in cases]}



# --------------------------------------------------------------------------
# Classifier Domains Management (Admin-only)
#   /api/admin/domains         GET, POST
#   /api/admin/domains/{id}    PUT, DELETE
# --------------------------------------------------------------------------
from app.classifier.engine import reload_rules_cache
from app.persistence.models import ClassifierDomain


@router.get("/api/admin/domains")
def list_domains(user: str = Depends(require_cap("manage_domains"))) -> dict:
    """List all registered classifier domains and their keywords."""
    with SessionLocal() as s:
        domains = s.query(ClassifierDomain).order_by(ClassifierDomain.id.asc()).all()
        return {
            "domains": [
                {
                    "id": d.id,
                    "domain_key": d.domain_key,
                    "display_name": d.display_name,
                    "description": d.description,
                    "keywords": d.keywords,
                    "jira_project": d.jira_project,
                    "jira_assignee": d.jira_assignee,
                    "icon": d.icon or "BookOpen",
                    "color": d.color or "blue",
                    "custom_icon": d.custom_icon,
                    "is_active": d.is_active,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                    "updated_at": d.updated_at.isoformat() if d.updated_at else None,
                }
                for d in domains
            ]
        }


@router.post("/api/admin/domains")
def create_domain(req: DomainCreateRequest,
                  user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Create a new domain with its classification keywords."""
    key = req.domain_key.strip().lower()
    cleaned_keywords = [str(k).lower().strip() for k in req.keywords if str(k).strip()]

    with SessionLocal() as s:
        existing = s.query(ClassifierDomain).filter(ClassifierDomain.domain_key == key).first()
        if existing:
            raise HTTPException(status_code=400, detail=f"Domain key '{key}' already exists.")

        d = ClassifierDomain(
            domain_key=key,
            display_name=req.display_name.strip(),
            description=req.description,
            keywords=cleaned_keywords,
            jira_project=req.jira_project.strip() if req.jira_project else None,
            jira_assignee=req.jira_assignee.strip() if req.jira_assignee else None,
            icon=req.icon.strip() if req.icon else "BookOpen",
            color=req.color.strip() if req.color else "blue",
            custom_icon=req.custom_icon,
            is_active=req.is_active,
        )
        s.add(d)
        s.commit()
        s.refresh(d)

        # A brand-new domain has no profile, and an empty one is silently unroutable on the
        # keyword fallback. Draft description + keywords now, on the same model that routes
        # questions; a model outage must not block creating the domain, so this is best-effort.
        auto_profile = False
        if not cleaned_keywords or not (req.description or "").strip():
            from app.classifier.profile_suggest import suggest_profile

            suggested = suggest_profile(key=key, name=req.display_name.strip(),
                                        description=req.description or "",
                                        keywords=cleaned_keywords)
            if suggested:
                if not cleaned_keywords and suggested.get("keywords"):
                    d.keywords = suggested["keywords"]
                if not (req.description or "").strip() and suggested.get("description"):
                    d.description = suggested["description"]
                s.commit()
                auto_profile = True

        new_id = d.id

    reload_rules_cache()
    audit("domain_created", user,
          detail=f"domain={key}" + (" (profile auto-drafted)" if auto_profile else ""))
    return {"status": "ok", "id": new_id, "domain_key": key, "auto_profile": auto_profile}


@router.put("/api/admin/domains/{domain_id}")
def update_domain(domain_id: int,
                  req: DomainUpdateRequest,
                  user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Update domain keywords or configuration."""
    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")

        if req.display_name is not None:
            d.display_name = req.display_name.strip()
        if req.description is not None:
            d.description = req.description
        if req.keywords is not None:
            d.keywords = [str(k).lower().strip() for k in req.keywords if str(k).strip()]
        if req.jira_project is not None:
            d.jira_project = req.jira_project.strip() if req.jira_project else None
        if req.jira_assignee is not None:
            d.jira_assignee = req.jira_assignee.strip() if req.jira_assignee else None
        if req.icon is not None:
            d.icon = req.icon.strip() if req.icon else "BookOpen"
        if req.color is not None:
            d.color = req.color.strip() if req.color else "blue"
        if req.custom_icon is not None:
            d.custom_icon = req.custom_icon if req.custom_icon.strip() else None
        if req.is_active is not None:
            d.is_active = req.is_active

        s.commit()
        key = d.domain_key

    reload_rules_cache()
    audit("domain_updated", user, detail=f"domain={key}")
    return {"status": "ok", "id": domain_id, "domain_key": key}


class DomainAssigneesRequest(BaseModel):
    users: list[str] = []
    groups: list[str] = []


def _domain_assignees(s, key: str) -> dict:
    from app.persistence.models import DomainAssignee

    rows = s.query(DomainAssignee).filter(DomainAssignee.domain_key == key).all()
    return {
        "users": [r.principal for r in rows if r.principal_type == "user"],
        "groups": [r.principal for r in rows if r.principal_type == "group"],
    }


@router.get("/api/admin/domains/{domain_id}/assignees")
def get_domain_assignees(domain_id: int,
                         user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Who can be assigned a ticket in this category (users + app groups)."""
    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")
        return {"domain_key": d.domain_key, **_domain_assignees(s, d.domain_key)}


@router.put("/api/admin/domains/{domain_id}/assignees")
def set_domain_assignees(domain_id: int, req: DomainAssigneesRequest,
                         user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Replace the category's assignee list.

    Empty lists are meaningful: they mean "no restriction", and the create dialog falls back
    to the whole assignable directory rather than offering nobody.
    """
    from app.persistence.models import DomainAssignee

    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")
        key = d.domain_key
        s.query(DomainAssignee).filter(DomainAssignee.domain_key == key).delete()
        for principal in dict.fromkeys(u.strip() for u in req.users if u.strip()):
            s.add(DomainAssignee(domain_key=key, principal_type="user", principal=principal[:128]))
        for principal in dict.fromkeys(g.strip() for g in req.groups if g.strip()):
            s.add(DomainAssignee(domain_key=key, principal_type="group", principal=principal[:128]))
        s.commit()
        result = _domain_assignees(s, key)

    audit("domain_assignees_updated", user,
          detail=f"domain={key} users={len(result['users'])} groups={len(result['groups'])}")
    return {"ok": True, "domain_key": key, **result}


# --------------------------------------------------------------------------
# App groups — the unit categories are assigned to.
#   /api/admin/groups          GET, POST
#   /api/admin/groups/{name}   PUT, DELETE
# --------------------------------------------------------------------------

class GroupRequest(BaseModel):
    name: str
    description: str | None = None
    role: str = "agent"
    members: list[str] = []


class GroupUpdateRequest(BaseModel):
    description: str | None = None
    role: str | None = None
    members: list[str] | None = None


def _group_rows(s) -> list[dict]:
    from app.persistence.models import AppGroup, GroupMember

    members: dict[str, list[str]] = {}
    for m in s.query(GroupMember).all():
        members.setdefault(m.group_name, []).append(m.username)
    return [
        {"name": g.name, "description": g.description, "role": g.role,
         "members": sorted(members.get(g.name, []))}
        for g in s.query(AppGroup).order_by(AppGroup.name).all()
    ]


@router.get("/api/admin/groups")
def list_groups(user: str = Depends(require_cap("manage_users"))) -> dict:
    """Groups a ticket category can be assigned to, with their members."""
    with SessionLocal() as s:
        return {"groups": _group_rows(s)}


@router.post("/api/admin/groups")
def create_group(req: GroupRequest, user: str = Depends(require_cap("manage_users"))) -> dict:
    from app.persistence.models import AppGroup, GroupMember

    name = req.name.strip()[:64]
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    with SessionLocal() as s:
        if s.get(AppGroup, name):
            raise HTTPException(status_code=400, detail=f"Group '{name}' already exists")
        s.add(AppGroup(name=name, description=(req.description or "")[:255] or None,
                       role=(req.role or "agent")[:32]))
        for u in dict.fromkeys(x.strip() for x in req.members if x.strip()):
            s.add(GroupMember(group_name=name, username=u[:64]))
        s.commit()
        rows = _group_rows(s)
    audit("group_created", user, detail=f"group={name} members={len(req.members)}")
    return {"ok": True, "groups": rows}


@router.put("/api/admin/groups/{name}")
def update_group(name: str, req: GroupUpdateRequest,
                 user: str = Depends(require_cap("manage_users"))) -> dict:
    """Rename-free update: members are replaced wholesale, which is what the editor shows."""
    from app.persistence.models import AppGroup, GroupMember

    with SessionLocal() as s:
        g = s.get(AppGroup, name)
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        if req.description is not None:
            g.description = req.description[:255] or None
        if req.role is not None:
            g.role = req.role[:32] or "agent"
        if req.members is not None:
            s.query(GroupMember).filter(GroupMember.group_name == name).delete()
            for u in dict.fromkeys(x.strip() for x in req.members if x.strip()):
                s.add(GroupMember(group_name=name, username=u[:64]))
        s.commit()
        rows = _group_rows(s)
    audit("group_updated", user, detail=f"group={name}")
    return {"ok": True, "groups": rows}


@router.delete("/api/admin/groups/{name}")
def delete_group(name: str, user: str = Depends(require_cap("manage_users"))) -> dict:
    from app.persistence.models import AppGroup, DomainAssignee, GroupMember

    with SessionLocal() as s:
        if not s.get(AppGroup, name):
            raise HTTPException(status_code=404, detail="Group not found")
        s.query(GroupMember).filter(GroupMember.group_name == name).delete()
        s.query(DomainAssignee).filter(DomainAssignee.principal_type == "group",
                                       DomainAssignee.principal == name).delete()
        s.query(AppGroup).filter(AppGroup.name == name).delete()
        s.commit()
        rows = _group_rows(s)
    audit("group_deleted", user, detail=f"group={name}")
    return {"ok": True, "groups": rows}


@router.post("/api/admin/domains/{domain_id}/suggest")
def suggest_domain_profile(domain_id: int,
                           user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Ask the routing model to draft a description and keyword fallback for this domain.

    Grounded in the titles already classified here, so the words are the ones this workspace
    actually uses. Returns a suggestion only — saving stays the admin's decision.
    """
    from sqlalchemy import text as _t

    from app.classifier.profile_suggest import suggest_profile

    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")
        titles = [r["title"] for r in s.execute(
            _t("SELECT title FROM kb_meta WHERE lower(domain) = :k "
               "AND title IS NOT NULL ORDER BY last_synced DESC LIMIT 25"),
            {"k": d.domain_key}).mappings().all()]
        payload = dict(key=d.domain_key, name=d.display_name,
                       description=d.description or "", keywords=d.keywords or [],
                       titles=titles)

    out = suggest_profile(**payload)
    if out is None:
        raise HTTPException(
            status_code=503,
            detail="The routing model is not available — check Settings → Integrations → LLM.",
        )
    return {"ok": True, "domain_key": payload["key"], "articles_used": len(titles), **out}


@router.delete("/api/admin/domains/{domain_id}")
def delete_domain(domain_id: int,
                  user: str = Depends(require_cap("manage_domains"))) -> dict:
    """Delete a classifier domain (or deactivate if it is a core domain)."""
    with SessionLocal() as s:
        d = s.query(ClassifierDomain).filter(ClassifierDomain.id == domain_id).first()
        if not d:
            raise HTTPException(status_code=404, detail="Domain not found.")

        key = d.domain_key
        # If it's a default/core domain, toggle is_active=false instead of hard delete
        if key in ("database", "network", "security", "server"):
            d.is_active = False
            s.commit()
            action = "deactivated"
        else:
            s.delete(d)
            s.commit()
            action = "deleted"

    reload_rules_cache()
    audit(f"domain_{action}", user, detail=f"domain={key}")
    return {"status": "ok", "action": action, "domain_key": key}
