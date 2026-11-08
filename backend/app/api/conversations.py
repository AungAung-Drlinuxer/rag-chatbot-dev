from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text as sqltext

from app.auth.deps import get_current_user
from app.config import SETTINGS
from app.observability.audit import audit
from app.persistence.database import SessionLocal
from app.rag.gate import DECISION_CAUTION, caution_message
from app.persistence.models import ChatSession, ChatMessage

router = APIRouter()

@router.get("/api/conversations")
def list_conversations(user: str = Depends(get_current_user), limit: int = 20) -> dict:
    """Recent conversations for the current user (RECENT CONVERSATIONS sidebar)."""
    from sqlalchemy import func

    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        rows = (
            s.query(
                ChatSession.id,
                func.max(ChatMessage.created_at).label("last_at"),
                func.count(ChatMessage.id).label("messages"),
                ChatSession.title,
                ChatSession.is_pinned,
            )
            .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
            .filter(ChatSession.username == user)
            .group_by(ChatSession.id)
            .order_by(ChatSession.is_pinned.desc(), func.max(ChatMessage.created_at).desc(), ChatSession.id)
            .limit(limit)
            .all()
        )
        convs = []
        for r in rows:
            session_title = r[3]
            first = (
                s.query(ChatMessage.content)
                .filter(ChatMessage.session_id == r[0], ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
                .first()
            )
            # S1.3 — when a session has no stored title (rows created before the
            # auto-title change), derive it with the SAME deterministic cleaner so
            # the sidebar reads consistently instead of showing a raw 80-char
            # question dump. Backfilled rows are persisted below, best-effort.
            from app.textutil import auto_title

            if session_title:
                title = session_title
            else:
                title = auto_title(first[0]) if first and first[0] else "New conversation"
                if first:
                    try:
                        from app.persistence.models import ChatSession as _CS
                        _row = s.get(_CS, r[0])
                        if _row is not None and not _row.title:
                            _row.title = title
                            s.commit()
                    except Exception:
                        s.rollback()  # backfill is best-effort; listing must not fail
            convs.append({
                "session_id": str(r[0]),
                "title": title,
                "last_at": r[1].isoformat() if r[1] else None,
                "messages": r[2],
                "is_pinned": bool(r[4]),
            })
        return {"conversations": convs}
    finally:
        s.close()


@router.patch("/api/conversations/{session_id}")
def update_conversation(session_id: str, payload: dict, user: str = Depends(get_current_user)) -> dict:
    """v0.21.38 — rename / pin a conversation (owner only)."""
    from app.persistence.database import SessionLocal
    from app.persistence.models import ChatSession
    from uuid import UUID as _UUID
    try:
        sid = _UUID(session_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid session id")
    with SessionLocal() as s:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != user:
            raise HTTPException(status_code=404, detail="Conversation not found")
        if "title" in payload:
            title = (payload.get("title") or "").strip()[:200]
            sess.title = title or None
        if "is_pinned" in payload:
            sess.is_pinned = bool(payload.get("is_pinned"))
        s.commit()
    return {"ok": True, "title": sess.title, "is_pinned": sess.is_pinned}


@router.get("/api/conversations/{session_id}/messages")
def conversation_messages(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Load a conversation's full message history (sidebar click → reload chat)."""
    import uuid as _uuid

    from app.persistence.database import SessionLocal

    try:
        sid = _uuid.UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid session_id")

    s = SessionLocal()
    try:
        sess = s.get(ChatSession, sid)
        if sess is None or sess.username != user:
            raise HTTPException(status_code=404, detail="Conversation not found")
        rows = (
            s.query(ChatMessage)
            .filter(ChatMessage.session_id == sid)
            .order_by(ChatMessage.created_at.asc(), ChatMessage.id.asc())
            .all()
        )
        messages = []
        for m in rows:
            meta = None
            caution = None
            if m.role == "assistant" and m.meta:
                try:
                    meta = json.loads(m.meta)
                except (ValueError, TypeError):
                    meta = None
                if meta and meta.get("decision") == DECISION_CAUTION:
                    caution = caution_message()
            messages.append({
                "role": m.role,
                "content": m.content,
                "meta": meta,
                "caution": caution,
                "message_id": str(m.id),  # v0.21.90 — real row id so feedback survives reload
            })
        return {"session_id": session_id, "messages": messages}
    finally:
        s.close()


@router.delete("/api/conversations")
def clear_conversations(user: str = Depends(get_current_user)) -> dict:
    """Clear the current user's conversations (cascade their messages)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        ids = [r[0] for r in s.query(ChatSession.id).filter(ChatSession.username == user).all()]
        if ids:
            s.query(ChatMessage).filter(ChatMessage.session_id.in_(ids)).delete(synchronize_session=False)
            s.query(ChatSession).filter(ChatSession.id.in_(ids)).delete(synchronize_session=False)
            s.commit()
        return {"deleted": len(ids)}
    finally:
        s.close()


@router.delete("/api/conversations/{session_id}")
def delete_conversation(session_id: str, user: str = Depends(get_current_user)) -> dict:
    """Delete ONE conversation owned by the current user (cascades messages)."""
    from uuid import UUID as UUIDType

    from app.persistence.database import SessionLocal

    try:
        sid = UUIDType(session_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid session id")

    s = SessionLocal()
    try:
        row = s.get(ChatSession, sid)
        if not row or row.username != user:
            raise HTTPException(status_code=404, detail="conversation not found")
        s.query(ChatMessage).filter(ChatMessage.session_id == sid).delete(synchronize_session=False)
        s.delete(row)
        s.commit()
        return {"deleted": 1}
    finally:
        s.close()

