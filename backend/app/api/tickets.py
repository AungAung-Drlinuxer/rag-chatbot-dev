from __future__ import annotations

import logging
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role, require_role, require_cap
from app.config import SETTINGS
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

router = APIRouter(prefix="/api")

class TicketCreate(BaseModel):
    """v1.6.3 — schema drift fix: the UI sends `subject` (+ optional due_date) but this
    model only declared `summary`, so every create returned 422 'Field required' and the
    Create-ticket button silently failed. Accept both; `subject` wins."""
    subject: str | None = None
    summary: str | None = None  # legacy alias, kept for backwards compatibility
    description: str = ""
    priority: str = "medium"
    domain: str = "general"
    assignee: str | None = None
    due_date: str | None = None
    # v1.6.4 — where the ticket must be created. Per user policy there is no
    # Tickets are raised in Jira; there is no internal-only mode.
    destination: str = "jira"
    # v1.6.8 — chat session the request came from (chat dialog only); used to
    # drop the "ticket created" notice into the user's chat history.
    session_id: str | None = None

    def effective_subject(self) -> str:
        return (self.subject or self.summary or "").strip()

class CommentRequest(BaseModel):
    body: str

class TicketUpdateRequest(BaseModel):
    status: str | None = None
    assignee: str | None = None
    priority: str | None = None

class AttachmentRequest(BaseModel):
    filename: str
    content_type: str
    data_base64: str


@router.get("/ticket-destinations")
def list_ticket_destinations(user: str = Depends(get_current_user)) -> dict:
    """Configured external ticket destinations for the create dialogs.

    Jira is the only destination this deployment raises tickets in. The endpoint stays
    (the UI reads it to know whether to enable "Create ticket") but it can no longer
    advertise a connector the product does not run."""
    from app.integrations.jira import _jira_cfg

    j = _jira_cfg()
    return {"destinations": [
        {"key": "jira", "label": "Jira",
         "configured": bool(j.get("base_url") and j.get("email") and j.get("api_token"))},
    ]}


@router.get("/domains")
def list_active_domains(user: str = Depends(get_current_user)) -> dict:
    """v1.6.3 — active classifier domains for ticket category dropdowns.

    Previously the Category select in both the chat ticket dialog and the Tickets
    page used a HARDCODED 7-item list, so a domain created by a knowledge manager
    never appeared. This endpoint is readable by any authenticated user (unlike
    /api/admin/domains which requires manage_domains)."""
    from app.persistence.models import ClassifierDomain
    with SessionLocal() as s:
        rows = (s.query(ClassifierDomain)
                .filter(ClassifierDomain.is_active.is_(True))
                .order_by(ClassifierDomain.display_name.asc())
                .all())
        return {"domains": [
            {"key": d.domain_key, "label": d.display_name, "color": d.color or "blue"}
            for d in rows
        ]}


def _domain_labels() -> dict[str, str]:
    """v1.6.3 — domain_key → display_name for pretty category labels."""
    try:
        from app.persistence.models import ClassifierDomain
        with SessionLocal() as s:
            return {d.domain_key: d.display_name for d in s.query(ClassifierDomain).all()}
    except Exception:
        return {}


def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]


_jira_status_cache: dict[str, tuple[float, str]] = {}  # jira_key -> (ts, mapped_local_status)
_JIRA_SYNC_TTL = 60  # seconds

def _persist_status_changes(s, mapped_by_key: dict[str, str]) -> None:
    """Persist canonical statuses for many tickets with TWO statements, not 2N.

    One SELECT for every key, then one UPDATE per distinct status. The previous
    shape opened a fresh SessionLocal + SELECT + UPDATE per ticket inside the
    loop, so a board page with 50 tickets cost 50 pooled sessions and 100
    statements — and a session was leaked for every ticket whose status matched.
    """
    if not mapped_by_key:
        return
    keys = list(mapped_by_key)
    found = s.execute(
        text("SELECT id, jira_key, status FROM jira_tickets WHERE jira_key = ANY(:keys)"),
        {"keys": keys},
    ).all()
    by_status: dict[str, list[int]] = {}
    for row_id, key, current in found:
        want = mapped_by_key.get(key)
        if want and want != current and row_id is not None:
            by_status.setdefault(want, []).append(row_id)
    for status, ids in by_status.items():
        s.execute(
            text("UPDATE jira_tickets SET status = :s WHERE id = ANY(:ids)"),
            {"s": status, "ids": ids},
        )
    if by_status:
        s.commit()


def _bulk_upstream_status_refresh(rows: list[dict]) -> None:
    """v1.6.13 — auto-resync statuses from upstream on every list read.

    Per-issue live fetch, status-name mapped through the canonical model and cached
    60s per key so rapid page loads do not hammer Jira. Rows are only updated when the
    canonical status differs from the mirror.

    v1.6.14 — all DB writes for the batch go through one session and two
    statements (see `_persist_status_changes`); the per-ticket session in the
    loop was an N+1 that also leaked a session per unchanged ticket.
    """
    from app.integrations.ticket_status import canonical_from_jira_status

    now = time.time()
    jira_keys: list[str] = []
    for r in rows:
        jk = r.get("jira_key")
        if not jk:
            continue
        cached = _jira_status_cache.get(jk)
        if cached and (time.time() - cached[0]) < _JIRA_SYNC_TTL:
            r["status"] = cached[1]
            continue
        jira_keys.append(jk)

    if jira_keys:
        from app.integrations.jira import fetch_issue_status
        mapped_by_key: dict[str, str] = {}
        for jk in jira_keys:
            live = fetch_issue_status(jk)
            # One mapper only. The canonical model is the single source of truth
            # for status semantics (it also drives the transition table), and it
            # never returns None — so the old `mapped or _map_jira_status(...)`
            # fallback could not fire and was deleted with the duplicate mapper.
            mapped = canonical_from_jira_status(live.get("status") or "") if live.get("ok") else ""
            _jira_status_cache[jk] = (time.time(), mapped)
            if mapped:
                mapped_by_key[jk] = mapped
        with SessionLocal() as s:
            _persist_status_changes(s, mapped_by_key)
        for r in rows:
            key = r.get("jira_key")
            if key in mapped_by_key:
                r["status"] = mapped_by_key[key]



@router.get("/tickets")
def list_tickets(
    user: str = Depends(get_current_user),
    limit: int = 50,
) -> dict:
    role = get_role(user)
    limit = max(1, min(limit, 200))
    privileged = role in ("admin", "agent")

    # Tickets reconciliation found gone from Jira stay in the table (status='deleted') so the
    # escalation history survives, but they must not appear on the board.
    sql = (
        "SELECT id, jira_key, session_id, domain, status, created_by, created_at, "
        "subject, description, priority, assignee, due_date "
        "FROM jira_tickets "
        "WHERE COALESCE(status, '') <> 'deleted' "
        + ("AND created_by = :user " if not privileged else "")
        + "ORDER BY created_at DESC LIMIT :limit"
    )
    params: dict = {"limit": limit}
    if not privileged:
        params["user"] = user

    rows = _rows(sql, params)
    # v1.6.14 — the status refresh is the ONLY place that talks to Jira/OP. The
    # inline per-ticket loop that used to follow this call re-fetched every key,
    # re-mapped it with a second, weaker mapper and re-wrote the row: the board
    # paid twice for one answer, and the two mappers disagreed on "Pending"
    # (open vs pending). Removed; `_bulk_upstream_status_refresh` already sets
    # r["status"] and persists any change.
    _bulk_upstream_status_refresh(rows)

    _labels = _domain_labels()  # v1.6.3 — pretty category labels
    out = []
    for r in rows:
        out.append(
            {
                "id": r.get("jira_key") or f"IT-{r['id']}",
                "subject": r.get("subject") or ((r.get("domain") or "general") + " escalation"),
                "description": r.get("description"),
                "status": ({"created": "open"}.get(r.get("status") or "", r.get("status") or "open")),
                "priority": (r.get("priority") or "medium"),
                # v1.6.3 — pretty category label from the classifier registry
                "category": _labels.get(
                    (r.get("domain") or "general").lower(),
                    (r.get("domain") or "general").replace("_", " ").capitalize(),
                ),
                "requester": r.get("created_by") or "unknown",
                "assignee": r.get("assignee"),
                "due_date": r["due_date"].isoformat() if r.get("due_date") else None,
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                "updated_at": r["created_at"].isoformat() if r.get("created_at") else None,
            }
        )
    return {"tickets": out, "scope": "all" if privileged else "own"}


_require_create_tickets = require_cap("create_tickets")


@router.post("/tickets", status_code=http_status.HTTP_201_CREATED)
def create_ticket(
    req: TicketCreate,
    user: str = Depends(_require_create_tickets),
) -> dict:
    """Manual ticket creation — gated by the admin RBAC matrix (v0.21.57).

    v1.6.4 — destination policy (user mandate): a manual ticket MUST exist in
    Jira. Local-only tickets are no longer accepted: if the
    external create fails, the request fails with 502 and nothing is saved.
    (A mirror row is still kept in jira_tickets so the Tickets board, filters
    and audit keep working — the external key is the source of truth.)
    """
    with SessionLocal() as s:
        from app.persistence.models import JiraTicket

        subj = req.effective_subject()
        if not subj:
            raise HTTPException(status_code=400, detail="Ticket subject is required")
        summary = subj[:120]
        destination = (req.destination or "jira").lower().strip()
        if destination != "jira":
            raise HTTPException(status_code=400,
                                detail="destination must be 'jira' — it is the only configured tracker")

        from app.integrations.jira import escalate as jira_escalate
        res = jira_escalate(
            summary=summary,
            description=req.description,
            reporter=user,
            project=None,  # jira_route(domain) decides inside escalate
            assignee=req.assignee or None,  # v0.21.98 — honor chosen assignee in Jira
            domain=req.domain,
        )
        ext_key, ext_link, ext_mode = res.get("jira_key"), res.get("link", ""), res.get("mode", "")
        if not ext_key:
            raise HTTPException(
                status_code=502,
                detail=f"Jira ticket creation failed"
                       f"{(': ' + res['error']) if res.get('error') else ' (integration not configured — check Settings → Integrations)'}")

        from datetime import datetime as _dt

        row = JiraTicket(
            jira_key=ext_key,
            domain=req.domain[:64],
            status="open",
            created_by=user,
            subject=subj[:200],
            description=req.description,
            priority=req.priority[:16],
            assignee=(req.assignee or None),
            due_date=(_dt.fromisoformat(req.due_date) if req.due_date else None),
        )
        s.add(row)
        s.commit()
        s.refresh(row)
        # v0.21.92 — alert the requester their ticket is open
        try:
            from app.notifier import notify_ticket_created
            notify_ticket_created(user, ext_key, subj[:120])
        except Exception:  # noqa: BLE001
            pass
        # v1.6.8 — drop the creation notice into the user's chat history so the
        # chatbox shows it after reload too (chat dialog only; best-effort).
        if req.session_id:
            try:
                from app.persistence.models import ChatMessage
                notice = (
                    f"✅ Ticket {ext_key} created in "
                    "Jira."
                    + (f" Follow: {ext_link}" if ext_link else "")
                    + " The IT team will follow up."
                )
                s.add(ChatMessage(session_id=req.session_id, role="assistant",
                                  content=notice))
                s.commit()
            except Exception:  # noqa: BLE001
                pass
        return {
            "id": ext_key,
            "destination": destination,
            "jira_mode": ext_mode,
            "jira_link": ext_link,
            "subject": subj[:120],
            "description": req.description,
            "status": "open",
            "priority": req.priority,
            "category": _domain_labels().get(
                req.domain.lower(), req.domain.replace("_", " ").capitalize()
            ),
            "requester": user,
            "assignee": row.assignee,
            "due_date": row.due_date.isoformat() if row.due_date else None,
        }


# ---------------------------------------------------------------------------
# v0.20.0 — ticket comments + field updates (native-Jira-style detail drawer)
# ---------------------------------------------------------------------------

def _resolve_ticket(ticket_ref: str, user: str):
    """Map 'ITHD-2' or 'IT-7' to the jira_tickets row (RBAC-checked)."""
    from app.persistence.models import JiraTicket

    with SessionLocal() as s:
        if ticket_ref.startswith("ITHD-"):
            row = s.query(JiraTicket).filter(JiraTicket.jira_key == ticket_ref).first()
        else:
            try:
                tid = int(ticket_ref.replace("IT-", ""))
            except ValueError:
                return None
            row = s.get(JiraTicket, tid)
        if row is None:
            return None
        role = get_role(user)
        if role not in ("admin", "agent") and (row.created_by or "") != user:
            return None
        return row


def _sync_jira_status(row):
    """Pull live status from Jira into the local row (v0.20.7 — Jira wins on status).
    Called when a user opens a ticket so they always see the current state."""
    if not row.jira_key:
        return None
    from app.integrations.jira import fetch_issue_status

    live = fetch_issue_status(row.jira_key)
    if not live.get("ok"):
        return None
    jira_status = (live.get("status") or "").strip().lower()
    if not jira_status:
        return None
    # v1.6.9 — canonical status mapping (ticket_status.py)
    from app.integrations.ticket_status import canonical_from_jira_status
    local = canonical_from_jira_status(jira_status) or None
    if local and row.status != local:
        old = row.status
        row.status = local
        with SessionLocal() as s:
            s.add(row)
            s.refresh(row)
            s.commit()
            from app.persistence.models import TicketComment

            s.add(TicketComment(ticket_id=row.id, author="Jira",
                                body=f"status synced from Jira: {old} → {local} "
                                     f"(Jira status: {jira_status})", kind="status"))
            s.commit()
        # v0.21.92 — alert the requester about the status transition
        try:
            from app.notifier import notify_ticket_status
            notify_ticket_status(row.created_by, row.jira_key, old, local)
        except Exception:  # noqa: BLE001
            pass
        return local
    return None


@router.get("/tickets/{ticket_ref}/comments")
def ticket_comments(ticket_ref: str, user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    synced = _sync_jira_status(row)  # v0.20.7 — Jira is source of truth for status
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT id, author, body, kind, created_at FROM ticket_comments "
               "WHERE ticket_id = :tid ORDER BY created_at ASC"),
            {"tid": row.id},
        ).mappings().all()
    return {"comments": [
        {"id": r["id"], "author": r["author"], "body": r["body"],
         "kind": r["kind"],
         "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ], "synced_status": synced}


class CommentRequest(BaseModel):
    body: str


@router.post("/tickets/{ticket_ref}/comments")
def ticket_comment_add(ticket_ref: str, req: CommentRequest,
                       user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from app.persistence.models import TicketComment

        c = TicketComment(ticket_id=row.id, author=user, body=req.body[:4000], kind="comment")
        s.add(c)
        s.commit()
        return {"id": c.id, "author": user, "body": c.body, "kind": "comment",
                "created_at": c.created_at.isoformat() if c.created_at else None}


class TicketUpdateRequest(BaseModel):
    status: str | None = None
    assignee: str | None = None
    due_date: str | None = None  # ISO date
    subject: str | None = None
    description: str | None = None


@router.put("/tickets/{ticket_ref}")
def ticket_update(ticket_ref: str, req: TicketUpdateRequest,
                  user: str = Depends(get_current_user),
                  _role: str = Depends(require_role("admin", "agent"))) -> dict:
    # v0.22.00 — BUGFIX: `user` previously got require_role's return value (the ROLE
    # string "admin"), so _resolve_ticket checked ownership against "admin" and every
    # agent/admin status edit 404'd. Identity and authorization are separate deps now.
    row = _resolve_ticket(ticket_ref, user)
    logger.info("ticket_update ref=%s user=%s resolved=%s", ticket_ref, user, row is not None)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    changes: list[str] = []

    # Push the status to Jira FIRST. The old order committed locally and then reported
    # "Jira sync failed (…)" in a comment, so the board could sit in a state Jira never
    # accepted — the exact drift this endpoint exists to prevent. A refusal is now a 409
    # and nothing changes here.
    sync_notes: list[str] = []
    if req.status and getattr(row, "jira_key", None):
        from app.integrations.jira import transition_issue

        tr = transition_issue(row.jira_key, req.status)
        if not tr.get("ok"):
            logger.warning("jira transition refused for %s: %s", row.jira_key, tr.get("detail"))
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"Jira refused the status change: {tr.get('detail')}",
            )
        # The transition name can land somewhere adjacent to what was asked: from DONE the only
        # way out is "Reopen issue", which produces REOPENED. Store what Jira actually reports
        # so the row never claims a state the issue is not in.
        try:
            from app.integrations.jira import fetch_issue_status

            live = fetch_issue_status(row.jira_key)
            if live.get("ok") and live.get("status"):
                req.status = canonical_from_jira_status(live["status"])
        except Exception:  # noqa: BLE001 - the transition itself succeeded
            pass
        sync_notes.append("synced to Jira")

    with SessionLocal() as s:
        s.add(row)
        s.refresh(row)
        if req.status:
            row.status = req.status[:32].lower()
            changes.append(f"status → {row.status}")
        if req.assignee is not None:
            row.assignee = req.assignee[:64] or None
            changes.append(f"assignee → {row.assignee or 'Unassigned'}")
        if req.due_date is not None:
            from datetime import datetime as _dt
            row.due_date = _dt.fromisoformat(req.due_date) if req.due_date else None
            changes.append(f"due date → {req.due_date or 'none'}")
        if req.subject:
            row.subject = req.subject[:200]
            changes.append("subject edited")
        if req.description is not None:
            row.description = req.description
            changes.append("description edited")
        s.commit()

        from app.persistence.models import TicketComment

        # The transition already happened above, before the local write.
        jira_note = (" · " + " · ".join(sync_notes)) if sync_notes else ""

        if changes or jira_note:
            body = "; ".join(changes) + jira_note if changes else f"Upstream sync: {jira_note.strip(' ·')}"
            s.add(TicketComment(ticket_id=row.id, author=user,
                                body=body, kind="status"))
            s.commit()
    return {"ok": True, "changes": changes, "jira_synced": jira_note.endswith("synced to Jira")}



@router.get("/tickets/{ticket_ref}/attachments")
def ticket_attachments(ticket_ref: str, user: str = Depends(get_current_user)) -> dict:
    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(
            _t("SELECT id, filename, content_type, size_bytes, created_by, created_at "
               "FROM ticket_attachments WHERE ticket_id = :tid ORDER BY created_at"),
            {"tid": row.id}).mappings().all()
    return {"attachments": [
        {"id": r["id"], "filename": r["filename"], "content_type": r["content_type"],
         "size": r["size_bytes"], "created_by": r["created_by"],
         "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ]}


@router.post("/tickets/{ticket_ref}/attachments")
def ticket_attachment_add(ticket_ref: str, req: AttachmentRequest,
                          user: str = Depends(get_current_user)) -> dict:
    import base64 as _b64

    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    try:
        blob = _b64.b64decode(req.data_base64)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid base64 payload")
    if len(blob) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="attachment exceeds 5 MB")
    with SessionLocal() as s:
        from app.persistence.models import TicketAttachment

        a = TicketAttachment(ticket_id=row.id, filename=req.filename[:255],
                             content_type=req.content_type[:128], data=blob,
                             size_bytes=len(blob), created_by=user)
        s.add(a)
        s.commit()
        return {"id": a.id, "filename": a.filename, "size": a.size_bytes}


@router.get("/tickets/{ticket_ref}/attachments/{att_id}/download")
def ticket_attachment_download(ticket_ref: str, att_id: int,
                               user: str = Depends(get_current_user)):
    from fastapi import Response

    row = _resolve_ticket(ticket_ref, user)
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="ticket not found")
    with SessionLocal() as s:
        from app.persistence.models import TicketAttachment

        a = s.get(TicketAttachment, att_id)
        if a is None or a.ticket_id != row.id:
            raise HTTPException(status_code=404, detail="attachment not found")
        return Response(
            content=a.data,
            media_type=a.content_type or "application/octet-stream",
            headers={"Content-Disposition": f'attachment; filename="{a.filename}"'},
        )






# === v0.21.15 — User settings (per-user preferences persisted to DB) ===
# Uses the existing user_settings table (Phase 10.1 schema); we store the
# chatbot-specific preferences in a `prefs` JSONB column.


@router.post("/attachments")
async def upload_attachment(
    file: UploadFile = File(...),
    session_id: str = Form(""),
    user: str = Depends(get_current_user),
) -> dict:
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    mime = file.content_type or "application/octet-stream"
    att_id = uuid4().hex
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        s.execute(_t(
            "INSERT INTO chat_attachments (id, session_id, username, filename, mime, size, data) "
            "VALUES (:id, :sid, :u, :fn, :mime, :sz, :data)"
        ), {"id": att_id, "sid": session_id, "u": user, "fn": file.filename,
            "mime": mime, "sz": len(data), "data": data})
        s.commit()
    return {"id": att_id, "filename": file.filename, "mime": mime, "size": len(data)}


@router.get("/attachments/{att_id}")
def get_attachment(att_id: str, user: str = Depends(get_current_user)):
    from fastapi.responses import Response
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        row = s.execute(_t(
            "SELECT filename, mime, data FROM chat_attachments WHERE id = :id"
        ), {"id": att_id}).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return Response(content=bytes(row[2]), media_type=row[1],
                    headers={"Content-Disposition": f'inline; filename="{row[0]}"'})


# === v1.6.8 — Jira ticket sync (pull upstream -> local mirror) ================
@router.post("/tickets/jira/sync")
def jira_sync(user: str = Depends(require_cap("manage_kb"))) -> dict:
    """Pull Jira issues/requests into jira_tickets (jira_key='<KEY>').

    Idempotent: existing keys are updated in place,
    new ones inserted with created_by='jira-sync'. Admin/agent-triggered from
    Settings -> Integrations -> Jira.
    """
    from app.integrations.jira import fetch_all_tickets
    from app.integrations.ticket_status import canonical_from_jira_status

    tickets = fetch_all_tickets()
    if not tickets:
        return {"ok": True, "created": 0, "updated": 0, "total": 0,
                "message": "No tickets returned — check Jira config in Settings"}

    created = updated = 0
    with SessionLocal() as s:
        for t in tickets:
            key = t["jira_key"]  # store the real Jira key (ITHD-xx), not the jira- prefix
            existing = s.execute(
                text("SELECT id FROM jira_tickets WHERE jira_key = :k"),
                {"k": key},
            ).first()
            if existing:
                s.execute(text(
                    "UPDATE jira_tickets SET status=:st, subject=:sj, description=:ds, "
                    "assignee=:asg WHERE jira_key=:k"
                ), {"st": canonical_from_jira_status(t["status"]),
                    "sj": t["title"], "ds": t["body"],
                    "asg": t["assignee"] or None, "k": key})
                updated += 1
            else:
                s.execute(text(
                    "INSERT INTO jira_tickets (jira_key, domain, status, created_by, "
                    "created_at, subject, description, priority, assignee) "
                    "VALUES (:k, :dm, :st, :cb, COALESCE(:ca, NOW()), :sj, :ds, :pr, :asg)"
                ), {"k": key, "dm": "general",
                    "st": canonical_from_jira_status(t["status"]),
                    "cb": "jira-sync", "ca": t.get("created_at"),
                    "sj": t["title"], "ds": t["body"],
                    "pr": t.get("priority") or "medium",
                    "asg": t["assignee"] or None})
                created += 1
        s.commit()
    return {"ok": True, "created": created, "updated": updated, "total": len(tickets)}


# === v0.21.14 — RBAC role/permission matrix (admin-editable) ===



# === Jira reconciliation (mirror -> Jira, including deleted issues) ==========
@router.post("/tickets/reconcile")
def reconcile_tickets(
    limit: int = 200,
    user: str = Depends(require_cap("manage_kb")),
) -> dict:
    """Ask Jira about every mirrored ticket and fix the mirror.

    Three outcomes, and only one of them is destructive:
      * Jira answers 404        -> the row is marked `deleted` and drops off the board,
      * Jira answers a status   -> the canonical status is adopted,
      * Jira cannot be reached  -> nothing changes (an outage is not a deletion).

    The nightly Celery task runs the same function; this endpoint exists so an operator can
    fix the board immediately after deleting an issue in Jira instead of waiting for 03:15.
    """
    from app.integrations.jira_reconcile import reconcile_jira
    from app.observability.audit import audit

    result = reconcile_jira(limit=limit)
    try:
        audit("tickets.reconcile", user, detail=f" checked={result['checked']} missing={result['missing']}")
    except Exception:
        pass
    return {"ok": True, **result}
