"""Human-in-the-loop Jira escalation (v1.0.55).

Two endpoints, deliberately separate:

- `POST /api/escalations/draft` reads the conversation, redacts it, asks the model for a
  structured draft and returns it **without touching Jira**. Nothing is created here.
- `POST /api/escalations/submit` takes back the fields the user edited and creates the
  ticket. The body that arrives is the body that is posted — the server does not
  regenerate anything between review and submit.

Everything else (conversation ownership, duplicate clicks, audit, chat notice) hangs off
those two.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.auth.deps import get_current_user
from app.auth.rbac import require_cap
from app.escalation import jira_fields
from app.escalation.draft import (
    compose_description,
    content_hash,
    generate_draft,
    redact,
)
from app.persistence.database import SessionLocal
from app.persistence.models import ChatMessage, ChatSession, EscalationDraft

logger = logging.getLogger("escalation.api")

router = APIRouter(prefix="/api/escalations", tags=["escalations"])

_require_create = require_cap("create_tickets")


# --------------------------------------------------------------------------- schemas
class DraftRequest(BaseModel):
    session_id: str


class SubmitRequest(BaseModel):
    draft_id: str
    base_hash: str = Field(description="content_hash of the draft the form was opened with")
    summary: str
    description: str
    project: str
    issue_type: str
    priority: str = ""
    custom_fields: dict = Field(default_factory=dict)
    idempotency_key: str


# --------------------------------------------------------------------------- helpers
def _own_session(s, session_id: str, user: str) -> ChatSession:
    try:
        sess = s.get(ChatSession, session_id)
    except Exception:  # malformed uuid
        sess = None
    if sess is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if sess.username != user:
        # Same answer as "missing": a stranger learns nothing about someone else's id.
        raise HTTPException(status_code=404, detail="Conversation not found")
    return sess


def _kb_links(messages: Sequence[ChatMessage]) -> list[dict]:
    seen, out = set(), []
    for m in messages:
        if not m.meta:
            continue
        try:
            meta = json.loads(m.meta)
        except (TypeError, ValueError):
            continue
        for hit in meta.get("hits") or []:
            url = str(hit.get("source_url") or hit.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            out.append({"title": str(hit.get("title") or url), "url": url})
    return out[:10]


def _defaults() -> tuple[str, str, list[str], bool]:
    """(project, issue_type, priorities, configured) — from Jira when reachable."""
    from app.integrations.jira import _jira_cfg

    cfg = _jira_cfg()
    project = (cfg.get("project") or "").strip()
    issue_type = "Task"
    if project and jira_fields.configured():
        try:
            meta = jira_fields.create_meta(project)
            names = [t["name"] for t in meta["issue_types"] if not t.get("subtask")]
            issue_type = names[0] if names else issue_type
        except Exception as exc:  # noqa: BLE001
            logger.info("issue-type lookup failed (%s): %s", type(exc).__name__, exc)
    return project, issue_type, jira_fields.priorities(), jira_fields.configured()


# --------------------------------------------------------------------------- metadata
@router.get("/fields")
def fields(project: str = Query(default=""), user: str = Depends(get_current_user)) -> dict:
    """What the form may offer: projects, issue types, priorities, required fields."""
    configured = jira_fields.configured()
    projects: list[dict] = []
    if configured:
        try:
            from app.integrations.jira import jira_get

            data = jira_get("/rest/api/3/project/search", {"maxResults": 50})
            projects = [{"key": p.get("key"), "name": p.get("name")}
                        for p in (data or {}).get("values", []) if p.get("key")]
        except Exception as exc:  # noqa: BLE001
            logger.info("project list failed (%s): %s", type(exc).__name__, exc)

    default_project, default_type, priorities, _ = _defaults()
    target = project or default_project
    issue_types: list[dict] = []
    required: list[dict] = []
    if configured and target:
        try:
            meta = jira_fields.create_meta(target)
            issue_types = [t for t in meta["issue_types"] if not t.get("subtask")]
            required = meta.get("required_fields") or []
        except Exception as exc:  # noqa: BLE001
            logger.info("createmeta failed (%s): %s", type(exc).__name__, exc)

    return {
        "configured": configured,
        "projects": projects,
        "default_project": target,
        "issue_types": issue_types or [{"id": "", "name": default_type}],
        "default_issue_type": default_type,
        "priorities": priorities,
        "required_fields": required,
    }


# --------------------------------------------------------------------------- draft
@router.post("/draft")
def create_draft(req: DraftRequest, user: str = Depends(get_current_user)) -> dict:
    """Read the conversation, redact it, draft the ticket. Creates nothing in Jira."""
    with SessionLocal() as s:
        sess = _own_session(s, req.session_id, user)
        sess_id = sess.id
        rows = s.execute(
            select(ChatMessage).where(ChatMessage.session_id == sess.id)
            .order_by(ChatMessage.id)
        ).scalars().all()

    messages = [{"role": m.role, "content": m.content or "", "id": m.id} for m in rows]
    if not messages:
        raise HTTPException(status_code=400, detail="This conversation has no messages to escalate.")

    started = time.time()
    fields, source = generate_draft(messages)
    fields["kb_links"] = _kb_links(rows)

    project, issue_type, _priorities, _configured = _defaults()
    fields.update({"project": project, "issue_type": issue_type, "priority": "",
                   "custom_fields": {}})
    fields["description"] = compose_description(fields)
    # The whole payload is redacted once more: the model may have echoed a secret that
    # was already replaced in the prompt, and the KB links can carry query strings.
    fields["description"] = redact(fields["description"])
    fields["summary"] = redact(fields["summary"])

    draft_id = str(uuid4())
    digest = content_hash(fields)
    with SessionLocal() as s:
        s.add(EscalationDraft(
            id=draft_id, username=user, session_id=sess_id,
            payload=fields, content_hash=digest, status="draft",
        ))
        s.commit()

    logger.info("escalation draft %s for %s (%s, %.1fs)", draft_id, user, source,
                time.time() - started)
    return {
        "draft_id": draft_id,
        "session_id": str(sess_id),
        "content_hash": digest,
        "source": source,
        **fields,
    }


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, user: str = Depends(get_current_user)) -> dict:
    """Re-open a draft (a failed submit leaves the edited text here)."""
    with SessionLocal() as s:
        row = s.get(EscalationDraft, draft_id)
        if row is None or row.username != user:
            raise HTTPException(status_code=404, detail="Draft not found")
        return {
            "draft_id": row.id,
            "session_id": str(row.session_id),
            "content_hash": row.content_hash,
            "status": row.status,
            "jira_key": row.jira_key,
            "jira_link": row.jira_link,
            "error": row.error,
            **row.payload,
        }


# --------------------------------------------------------------------------- submit
@router.post("/submit")
def submit(req: SubmitRequest, user: str = Depends(_require_create)) -> dict:
    """Create the Jira ticket from the reviewed fields. Idempotent per key."""
    submitted = {
        "summary": req.summary.strip(),
        "description": req.description.strip(),
        "project": req.project.strip(),
        "issue_type": req.issue_type.strip(),
        "priority": req.priority.strip(),
        "custom_fields": req.custom_fields or {},
    }

    errors = jira_fields.validate(submitted)
    if errors:
        raise HTTPException(status_code=422, detail={"errors": errors})

    with SessionLocal() as s:
        row = s.execute(
            select(EscalationDraft).where(EscalationDraft.id == req.draft_id).with_for_update()
        ).scalar_one_or_none()
        if row is None or row.username != user:
            raise HTTPException(status_code=404, detail="Draft not found")

        # Already created — a retry, a double click or a second tab. Return the ticket
        # instead of opening a duplicate.
        if row.jira_key:
            return {"jira_key": row.jira_key, "link": row.jira_link or "",
                    "duplicate": True, "status": "submitted"}

        if row.content_hash != req.base_hash:
            raise HTTPException(
                status_code=409,
                detail="This draft was regenerated in another tab. Reopen the form before submitting.",
            )

        # Idempotency across two drafts with the same key (double submit raced here).
        if req.idempotency_key:
            twin = s.execute(
                select(EscalationDraft).where(EscalationDraft.idempotency_key == req.idempotency_key)
            ).scalar_one_or_none()
            if twin and twin.jira_key:
                return {"jira_key": twin.jira_key, "link": twin.jira_link or "",
                        "duplicate": True, "status": "submitted"}

        row.idempotency_key = req.idempotency_key or None
        row.approved_hash = content_hash(submitted)
        row.payload = {**(row.payload or {}), **submitted}
        s.commit()

        from app.integrations.jira import create_issue

        result = create_issue(
            summary=submitted["summary"],
            description=submitted["description"],
            project=submitted["project"],
            issue_type=submitted["issue_type"] or "Task",
            priority=submitted["priority"] or None,
            custom_fields=submitted["custom_fields"],
            reporter=user,
        )

        if not result.get("jira_key"):
            row.status = "failed"
            row.error = result.get("error") or "Jira did not return a ticket key"
            s.commit()
            logger.warning("escalation %s failed: %s", row.id, row.error)
            raise HTTPException(status_code=502, detail={
                "message": "Jira did not create the ticket. The draft is unchanged — fix and retry.",
                "error": row.error,
            })

        key, link = result["jira_key"], result.get("link") or ""
        row.status = "submitted"
        row.jira_key = key
        row.jira_link = link
        row.error = None
        row.submitted_at = datetime.now(UTC)

        # Audit: who asked, from which conversation, what they approved, what came back.
        from app.persistence.models import AuditLog

        s.add(AuditLog(
            action="escalate.submitted", username=user, decision="approve",
            detail=json.dumps({
                "draft_id": row.id,
                "session_id": str(row.session_id),
                "jira_key": key,
                "approved_hash": row.approved_hash,
                "idempotency_key": req.idempotency_key,
                "priority": submitted["priority"],
                "issue_type": submitted["issue_type"],
                "project": submitted["project"],
            })[:2000],
        ))

        # Put the ticket in the transcript so it is there after a reload.
        try:
            s.add(ChatMessage(
                session_id=row.session_id, role="assistant",
                content=(f"✅ Ticket **{key}** created in Jira."
                         + (f"\n\n[Open {key}]({link})" if link else "")
                         + "\n\nThe IT team will follow up on this conversation."),
                meta=json.dumps({"decision": "escalation", "jira_key": key,
                                 "jira_link": link, "draft_id": row.id}),
            ))
        except Exception as exc:  # noqa: BLE001
            logger.debug("%s suppressed: %s", type(exc).__name__, exc)

        try:
            s.commit()
        except IntegrityError:
            s.rollback()
            twin = s.execute(select(EscalationDraft).where(
                EscalationDraft.idempotency_key == req.idempotency_key)).scalar_one_or_none()
            if twin and twin.jira_key:
                return {"jira_key": twin.jira_key, "link": twin.jira_link or "",
                        "duplicate": True, "status": "submitted"}
            raise HTTPException(status_code=409, detail="Duplicate submission") from None

    try:
        from app.notifier import notify_ticket_created

        notify_ticket_created(user, key, submitted["summary"][:120])
    except Exception as exc:  # noqa: BLE001
        logger.debug("%s suppressed: %s", type(exc).__name__, exc)

    return {"jira_key": key, "link": link, "duplicate": False, "status": "submitted"}
