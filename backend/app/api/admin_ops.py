from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role
from app.observability.audit import audit
from app.persistence.database import SessionLocal, engine

logger = logging.getLogger("dashboard")

router = APIRouter(prefix="/api")

def _db() -> Any:
    return SessionLocal()

def _rows(sql: str, params: dict | None = None) -> list[dict]:
    """Run a read query and return list[dict]."""
    with engine.begin() as conn:
        result = conn.execute(text(sql), params or {})
        return [dict(m) for m in result.mappings()]

# Canonical 4 roles and 5 capabilities. These are the defaults — admins can override
# any non-Administrator permission via PUT /api/rbac/matrix.
# v1.1.1 — Domain Manager merged into Knowledge Manager (single role owns
# manage_kb + manage_domains since the Knowledge page hosts both engines).
# ONE source of truth: the matrix lives in app.auth.rbac and the enforcement reads it
# from there. A second copy here is what kept the removed "IT Support" role on screen
# after the role itself was deleted.
from app.auth.rbac import _DEFAULT_MATRIX as _RBAC_DEFAULT_MATRIX

_RBAC_ROLES = tuple(_RBAC_DEFAULT_MATRIX.keys())


@router.get("/rbac/matrix")
def get_rbac_matrix(user: str = Depends(get_current_user)) -> dict:
    """Returns the role/permission matrix. Admin gets the editable view; non-admin gets a
    read-only copy. Defaults are returned for any role with no override row."""
    is_admin = get_role(user) == "admin"
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        rows = s.execute(_t(
            "SELECT role, permissions, updated_at, updated_by FROM rbac_matrix"
        )).mappings().all()
    overrides = {r["role"]: (r["permissions"], r["updated_at"], r["updated_by"]) for r in rows}
    out = []
    for role, perms in _RBAC_DEFAULT_MATRIX.items():
        if role in overrides:
            stored = overrides[role][0]
            merged = {**perms, **stored}  # override > default
            out.append({
                "role": role,
                "permissions": merged,
                "default": perms,
                "overridden": role in overrides,
                "updated_at": overrides[role][1].isoformat() if overrides[role][1] else None,
                "updated_by": overrides[role][2],
            })
        else:
            out.append({
                "role": role, "permissions": perms,
                "default": perms, "overridden": False,
                "updated_at": None, "updated_by": None,
            })
    return {"matrix": out, "editable": is_admin}


@router.put("/rbac/matrix")
def put_rbac_matrix(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: replace the permission matrix. payload = { "matrix": [ {role, permissions: {cap: bool}} ] }.
    Administrator row is rejected as a safety (admin must always have all perms)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    matrix = payload.get("matrix")
    if not isinstance(matrix, list):
        raise HTTPException(status_code=400, detail="matrix must be a list")
    # Validate + write
    import json as _json

    from sqlalchemy import text as _t
    with SessionLocal() as s:
        for row in matrix:
            role = (row.get("role") or "").strip()
            perms = row.get("permissions") or {}
            if role not in _RBAC_ROLES:
                raise HTTPException(status_code=400, detail=f"unknown role: {role}")
            if not isinstance(perms, dict):
                raise HTTPException(status_code=400, detail=f"permissions for {role} must be an object")
            # Ensure every default key is present
            merged = {**_RBAC_DEFAULT_MATRIX[role], **perms}
            if role == "Administrator":
                # Hard guarantee: admin always has everything
                merged = dict(_RBAC_DEFAULT_MATRIX["Administrator"])
            s.execute(_t(
                "INSERT INTO rbac_matrix (role, permissions, updated_by, updated_at) "
                "VALUES (:r, :p, :u, NOW()) "
                "ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, "
                "updated_by = EXCLUDED.updated_by, updated_at = NOW()"
            ), {"r": role, "p": _json.dumps(merged), "u": user})
        s.commit()
    try:
        from app.observability.audit import audit
        audit("rbac.matrix.update", user, detail="roles=" + ",".join(r["role"] for r in matrix))
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True, "count": len(matrix)}


# --- v0.21.58 — per-user permission overrides + groups ------------------------



@router.get("/users/{username}/permissions")
def get_user_permissions(username: str, user: str = Depends(get_current_user)) -> dict:
    """Admin view: role matrix caps + this user's personal overrides."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.auth.rbac import permissions_for

    with SessionLocal() as s:
        from sqlalchemy import text as _t

        row = s.execute(
            _t("SELECT permissions FROM user_permission_overrides WHERE username = :u"),
            {"u": username},
        ).first()
    return {
        "username": username,
        "effective": permissions_for(username),
        "overrides": row.permissions if row and row.permissions else {},
    }


@router.put("/users/{username}/permissions")
def put_user_permissions(username: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set per-user extra permissions (true/false per capability)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    perms = payload.get("permissions") or {}
    with SessionLocal() as s:
        s.execute(text(
            "INSERT INTO user_permission_overrides (username, permissions, updated_by) "
            "VALUES (:u, :p::jsonb, :by) "
            "ON CONFLICT (username) DO UPDATE SET permissions = :p::jsonb, updated_by = :by, updated_at = NOW()"
        ), {"u": username, "p": perms, "by": user})
        s.commit()
    try:
        audit("user.permissions.update", user, detail=f"target={username} perms={perms}")
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    from app.auth.rbac import permissions_for

    return {"ok": True, "username": username, "effective": permissions_for(username)}



@router.get("/runtime")
def get_runtime_settings(user: str = Depends(get_current_user)) -> dict:
    """Admin: current RAG runtime knobs (retrieval_top_k, confidence threshold, ...)."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.runtime import all_overrides

    return {"overrides": all_overrides()}


@router.put("/runtime")
def put_runtime_settings(payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: set RAG runtime knobs without redeploying."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    from app.runtime import set_ as runtime_set

    applied = {}
    for k, v in (payload.get("overrides") or {}).items():
        try:
            runtime_set(k, v)
            applied[k] = v
        except KeyError as _exc:
            logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {"ok": True, "applied": applied}


# --- v0.21.70 Phase 2 — escalation approval queue (human-in-the-loop) ---------

@router.get("/approvals")
def list_approvals(user: str = Depends(get_current_user)) -> dict:
    """Admin: pending escalation approvals."""
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(_t(
            "SELECT id, username, question, status, created_at FROM approvals "
            "ORDER BY created_at DESC LIMIT 50"
        )).mappings().all()
    return {"approvals": [
        {"id": str(r["id"]), "username": r["username"], "question": r["question"],
         "status": r["status"], "created_at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in rows
    ]}


@router.put("/approvals/{approval_id}")
def decide_approval(approval_id: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """Admin: approve or reject a pending escalation.

    v0.21.82 — the decision is delivered INTO the LangGraph via
    Command(resume=...); ticket creation now happens inside the graph's
    create_ticket node (single source of truth for state transitions).
    Returns the graph's final state (ticket_id + confirmation message).
    """
    decision = (payload.get("decision") or "").lower()
    if decision not in ("approved", "rejected", "cancelled"):
        raise HTTPException(
            status_code=400, detail="decision must be approved|rejected|cancelled"
        )

    # v1.6.40 — "cancelled" means the requester chose to fill the ticket form
    # themselves instead of going through approval. It must NOT resume the graph
    # (resuming would create a second, duplicate ticket), so it needs no admin
    # rights — only the requester of that escalation (or an admin) may do it.
    if decision == "cancelled":
        with SessionLocal() as s:
            from sqlalchemy import text as _t
            who = s.execute(
                _t("SELECT username FROM approvals WHERE id = :i AND status = 'pending'"),
                {"i": approval_id},
            ).scalar()
        if not who or (who != user and get_role(user) != "admin"):
            raise HTTPException(status_code=403, detail="You may only cancel your own escalation.")
        with SessionLocal() as s:
            from sqlalchemy import text as _t
            s.execute(
                _t("UPDATE approvals SET status = 'cancelled', decided_by = :by, decided_at = NOW() "
                   "WHERE id = :i AND status = 'pending'"),
                {"by": user, "i": approval_id},
            )
            s.commit()
        return {"ok": True, "approval_id": approval_id, "status": "cancelled",
                "ticket_id": None, "message": "Escalation cancelled — no ticket was created."}

    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")

    with SessionLocal() as s:
        from sqlalchemy import text as _t

        res = s.execute(_t(
            "UPDATE approvals SET status = :st, decided_by = :by, decided_at = NOW() "
            "WHERE id = :i AND status = 'pending' RETURNING username, question, thread_id"
        ), {"st": decision, "by": user, "i": approval_id}).mappings().first()
        s.commit()
    if not res:
        raise HTTPException(status_code=404, detail="Pending approval not found")

    # Resume the graph with the admin decision (ticket creation happens in-graph)
    from app.graph_rag import run_rag_graph

    thread_id = res.get("thread_id") or approval_id
    try:
        graph_state = run_rag_graph(
            query=res["question"] or "",
            user=res["username"],
            thread_id=thread_id,
            resume_command={"approved": decision == "approved", "decided_by": user},
        )
    except Exception as exc:  # graph/Jira hiccup → direct escalation fallback
        graph_state = {"approval_status": decision, "ticket_id": None,
                       "escalation_messages": [f"graph error: {exc}"]}
        if decision == "approved":
            try:
                from app.integrations.jira import escalate as jira_escalate
                from app.persistence.models import ChatMessage, JiraTicket

                summary = (res["question"] or "Escalation")[:120]
                jr = jira_escalate(summary=summary, description=res["question"] or "",
                                   reporter=res["username"] or None, domain="general")
                if not jr.get("jira_key"):
                    # v1.6.4 — external-only policy: no real key → do not save a phantom row
                    graph_state["escalation_messages"] = [
                        f"❌ Ticket was NOT created in Jira "
                        f"({jr.get('error') or 'no key returned'}) — nothing was saved."]
                    raise RuntimeError("jira create failed")
                with SessionLocal() as s:
                    s.add(JiraTicket(jira_key=jr.get("jira_key"), subject=summary,
                                     description=res["question"] or "",
                                     created_by=res["username"], status="Open"))
                    s.commit()
                try:
                    from app.notifier import notify_ticket_created
                    notify_ticket_created(res["username"], jr.get("jira_key"), summary)
                except Exception as _exc:
                    logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
                graph_state.update(
                    ticket_id=jr.get("jira_key"),
                    escalation_messages=[f"✅ Ticket ({jr.get('jira_key')}) opened successfully."])
            except Exception as exc2:
                _key = locals().get("jr") or {}
                if not (_key.get("jira_key") if isinstance(_key, dict) else None):
                    # v1.6.4 — keep the specific "NOT created" reason if already set
                    graph_state["escalation_messages"] = [f"escalation failed: {exc2}"]
    # v0.22.1 — deliver the outcome to the REQUESTER, not just the admin UI:
    # (1) persist an assistant ChatMessage in their thread so it shows on reload
    # (2) email them the ticket info (or rejection notice)
    ticket_id = graph_state.get("ticket_id")
    messages = graph_state.get("escalation_messages") or []
    requester = res.get("username")
    thread_id_raw = res.get("thread_id")
    try:
        if requester and thread_id_raw:
            import uuid as _uuid

            from sqlalchemy import text as _t2
            if decision == "approved" and ticket_id:
                reply = (f"✅ **Your escalation was approved.**\n\n"
                         f"**Ticket:** {ticket_id}\n"
                         f"**Subject:** {(res.get('question') or '')[:120]}\n"
                         f"**Status:** Open — the IT team will follow up shortly.\n"
                         f"You will receive email updates when the status changes.")
            else:
                reply = ("❌ **Your escalation was rejected by the administrator.**\n\n"
                         "If this still needs IT support, please contact the helpdesk "
                         "directly or submit a ticket from the Tickets page.")
            with SessionLocal() as s2:
                sid = None
                try:
                    sid = _uuid.UUID(str(thread_id_raw))
                except (ValueError, TypeError):
                    sid = None
                if sid is not None:
                    exists = s2.execute(_t2(
                        "SELECT 1 FROM chat_sessions WHERE id = :i AND username = :u"
                    ), {"i": sid, "u": requester}).first()
                    if exists:
                        s2.add(ChatMessage(session_id=sid, role="assistant", content=reply,
                                           meta=json.dumps({"decision": "answer", "escalation_outcome": decision})))
                        s2.commit()
    except Exception as _exc:
        logger.warning("escalation outcome persistence skipped (%s): %s",
                       type(_exc).__name__, _exc)

    # (2) email the requester
    try:
        from app.notifier import notify_ticket_created, send_alert, user_email
        if decision == "approved" and ticket_id:
            notify_ticket_created(requester, ticket_id, (res.get("question") or "")[:120])
        elif decision == "rejected":
            send_alert(
                "escalation_rejected",
                "[iTH] Your escalation was not approved",
                f"Your escalation request was reviewed and not approved.\n\n"
                f"Request: {(res.get('question') or '')[:200]}\n"
                f"Please contact the IT helpdesk if you still need assistance.\n",
                to_addr=user_email(requester),
            )
    except Exception as _exc:
        logger.warning("escalation requester email skipped (%s): %s",
                       type(_exc).__name__, _exc)

    try:
        audit("approval.decision", user, detail=f"id={approval_id} decision={decision} ticket={ticket_id}")
        from app.observability.metrics import ESCALATION_TICKETS_TOTAL
        ESCALATION_TICKETS_TOTAL.labels(status=decision).inc()
    except Exception as _exc:
        logger.debug("%s suppressed: %s", type(_exc).__name__, _exc)
    return {
        "ok": True,
        "decision": decision,
        "approval_status": graph_state.get("approval_status"),
        "ticket_id": ticket_id,
        "messages": messages,
    }


# --- v0.21.90 — admin audit log viewer ------------------------------------------

@router.get("/admin/audits")
def admin_list_audits(
    user: str = Depends(get_current_user),
    username: str = "", action: str = "", limit: int = 100,
    offset: int = 0,
) -> dict:
    """Admin: read the application audit trail (login/chat/escalate/feedback/sync)."""
    _require_admin_cap(user, "manage_users")
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    where = "WHERE 1=1"
    params: dict = {"limit": limit, "offset": offset}
    if username:
        where += " AND username = :username"
        params["username"] = username
    if action:
        where += " AND action = :action"
        params["action"] = action
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        rows = s.execute(_t(
            "SELECT id, action, username, domain, confidence, decision, detail, "
            "created_at FROM audit_log " + where +
            " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"
        ), params).mappings().all()
        total = s.execute(_t(
            "SELECT count(*) AS n FROM audit_log " + where
        ), {k: v for k, v in params.items() if k in ("username", "action")}).mappings().first()["n"]
        actions = [r["action"] for r in s.execute(_t(
            "SELECT DISTINCT action FROM audit_log ORDER BY action")).mappings().all()]
    out = [{
        "id": r["id"], "action": r["action"], "username": r["username"],
        "domain": r["domain"], "confidence": r["confidence"], "decision": r["decision"],
        "detail": r["detail"],
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]
    return {"audits": out, "total": total, "actions": actions}


@router.get("/admin/audits/export")
def admin_export_audits(
    user: str = Depends(get_current_user), username: str = "", action: str = "",
    format: str = "csv",
) -> str:
    """Admin: export the audit trail as CSV (download)."""
    _require_admin_cap(user, "manage_users")
    from fastapi import Response as _Resp

    where = "WHERE 1=1"
    params: dict = {}
    if username:
        where += " AND username = :username"; params["username"] = username
    if action:
        where += " AND action = :action"; params["action"] = action
    with SessionLocal() as s:
        from sqlalchemy import text as _t
        rows = s.execute(_t(
            "SELECT created_at, action, username, domain, decision, confidence, detail "
            "FROM audit_log " + where + " ORDER BY created_at DESC LIMIT 10000"
        ), params).mappings().all()
    import csv as _csv
    import io as _io

    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(["created_at", "action", "username", "domain", "decision", "confidence", "detail"])
    for r in rows:
        w.writerow([(r["created_at"].isoformat() if r["created_at"] else ""),
                    r["action"], r["username"] or "", r["domain"] or "",
                    r["decision"] or "", r["confidence"] if r["confidence"] is not None else "",
                    (r["detail"] or "").replace("\r", " ").replace("\n", " ")])
    return _Resp(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'},
    )


# --- v0.21.73 — admin conversation audit & export ------------------------------

def _require_admin_cap(user: str, cap: str) -> None:
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")


@router.get("/admin/conversations")
def admin_list_conversations(
    username: str = "", limit: int = 50, user: str = Depends(get_current_user)
) -> dict:
    """Admin: list ALL users' chat sessions (optionally filtered by username)."""
    _require_admin_cap(user, "manage_users")
    limit = max(1, min(limit, 200))
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        # v1.6.0 — derive titles from the first user message when chat_sessions.title is NULL
        sql = (
            "SELECT cs.id, cs.username, cs.title, cs.started_at, "
            "count(cm.id) AS messages, max(cm.created_at) AS last_at, "
            "(SELECT cm2.content FROM chat_messages cm2 "
            " WHERE cm2.session_id = cs.id AND cm2.role = 'user' "
            " ORDER BY cm2.created_at ASC LIMIT 1) AS first_user_msg "
            "FROM chat_sessions cs JOIN chat_messages cm ON cm.session_id = cs.id "
            "WHERE (:u = '' OR cs.username = :u) "
            "GROUP BY cs.id, cs.username, cs.title, cs.started_at "
            "ORDER BY max(cm.created_at) DESC LIMIT :lim"
        )
        rows = s.execute(_t(sql), {"u": username, "lim": limit}).mappings().all()

    def _derive_title(title, first_msg):
        if title:
            return title
        text = (first_msg or "").strip()
        if not text:
            return "(untitled)"
        return text[:60] + ("…" if len(text) > 60 else "")

    return {"conversations": [
        {"session_id": str(r["id"]), "username": r["username"],
         "title": _derive_title(r["title"], r["first_user_msg"]), "messages": int(r["messages"]),
         "started_at": r["started_at"].isoformat() if r["started_at"] else None,
         "last_at": r["last_at"].isoformat() if r["last_at"] else None}
        for r in rows
    ]}


@router.get("/admin/conversations/{session_id}/messages")
def admin_conversation_messages(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Admin: full transcript of one session."""
    _require_admin_cap(user, "manage_users")
    with SessionLocal() as s:
        from sqlalchemy import text as _t

        sess = s.execute(_t("SELECT username, title, started_at FROM chat_sessions WHERE id = :i"),
                         {"i": session_id}).mappings().first()
        if not sess:
            raise HTTPException(status_code=404, detail="Conversation not found")
        msgs = s.execute(_t(
            "SELECT role, content, meta, created_at FROM chat_messages "
            "WHERE session_id = :i ORDER BY created_at"
        ), {"i": session_id}).mappings().all()
    return {"username": sess["username"], "title": sess["title"],
            "started_at": sess["started_at"].isoformat() if sess["started_at"] else None,
            "messages": [
                {"role": m["role"], "content": m["content"],
                 "created_at": m["created_at"].isoformat() if m["created_at"] else None}
                for m in msgs
            ]}


@router.get("/admin/conversations/{session_id}/export")
def admin_conversation_export(session_id: str, format: str = "txt",
                              user: str = Depends(get_current_user)):
    """Admin: export a conversation transcript as .txt (or .json)."""
    _require_admin_cap(user, "manage_users")
    from fastapi.responses import Response

    d = admin_conversation_messages(session_id, user)
    fname = f"conversation-{d['username']}-{session_id[:8]}"
    if format == "json":
        import json as _json

        return Response(content=_json.dumps(d, indent=1, default=str),
                        media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="{fname}.json"'})
    lines = [
        "Conversation export — IT Help Chatbot",
        f"User: {d['username']}   Session: {session_id}",
        f"Started: {d['started_at']}   Title: {d['title'] or '(untitled)'}",
        f"Exported: {datetime.now(UTC).isoformat()} by {user}",
        "=" * 60, "",
    ]
    for m in d["messages"]:
        who = "USER" if m["role"] == "user" else "AI"
        lines.append(f"[{m['created_at']}] {who}:")
        lines.append(m["content"])
        lines.append("")
    return Response(content="\n".join(lines), media_type="text/plain; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{fname}.txt"'})
