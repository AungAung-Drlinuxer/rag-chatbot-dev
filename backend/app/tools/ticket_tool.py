"""Ticket status tool (v0.18.0) — agentic tool pattern.

Lets the chatbot answer questions about IT tickets ("my open tickets?",
"status of ITHD-2?") by querying jira_tickets directly with RBAC scoping,
instead of pretending the KB contains that data.

Design:
- detect_ticket_intent(query) -> bool: cheap heuristic (no LLM call)
- fetch_ticket_context(user, query) -> str: RBAC-scoped DB lookup formatted
  as LLM context. Returns "" when nothing applies.
- The orchestration layer injects this context ahead of the normal KB
  context so the LLM answers from real ticket rows.
"""
from __future__ import annotations

import re

from sqlalchemy import text

from app.config import SETTINGS
from app.persistence.database import SessionLocal

# ---------------------------------------------------------------------------
# intent detection — regex/heuristic, zero LLM cost
# ---------------------------------------------------------------------------

_TICKET_ID = re.compile(r"\bITHD-\d+\b", re.IGNORECASE)
_KEYWORDS = (
    "ticket", "tickets", "escalat", "jira",
    "issue status", "my request", "request status",
    "open tickets", "ticket status", "how many tickets",
)
_STATUS_WORDS = ("status", "progress", "update", "state")

# v0.21.90 — split the two intents apart. Asking about an EXISTING ticket is a
# read lookup (answer from the live DB), NOT a request to open a new one — it must
# never route into the HITL approval interrupt.
_CREATE_WORDS = (
    "create", "open", "file", "raise", "submit", "log ",
    "make a ticket", "new ticket", "escalate", "escalation",
)
_STATUS_QUERY_WORDS = (
    "status", "progress", "update", "state", "track",
    "where is", "how many", "resolved", "pending", "closed", "open tickets",
    "my tickets", "my ticket",
)


def detect_ticket_status_intent(query: str) -> bool:
    """True when the user asks about existing tickets (read lookup)."""
    q = query.lower()
    if _TICKET_ID.search(query):
        return True
    if any(w in q for w in _STATUS_QUERY_WORDS) and any(
        w in q for w in ("ticket", "request", "issue", "report", "jira", "my")
    ):
        return True
    return False


def detect_ticket_create_intent(query: str) -> bool:
    """True when the user asks to open/raise a NEW ticket or escalate."""
    q = query.lower()
    if detect_ticket_status_intent(query) and not any(c in q for c in ("create", "open", "file", "raise", "submit", "new ticket")):
        return False
    # Explicit escalate intent
    if "escalat" in q:
        return True
    if any(c in q for c in _CREATE_WORDS) and "ticket" in q:
        return True
    if any(c in q for c in _CREATE_WORDS) and any(w in q for w in ("issue", "problem", "bug", "fault", "error", "incident")):
        return True
    return False


def detect_ticket_intent(query: str) -> bool:
    """True when the user is asking about tickets rather than KB knowledge.

    v0.21.90 — status questions are answered from the live ticket DB, so the
    expensive/conflicting create+approval path only fires for create intent."""
    return detect_ticket_status_intent(query) or detect_ticket_create_intent(query)


# ---------------------------------------------------------------------------
# RBAC-scoped lookup
# ---------------------------------------------------------------------------

def _role_of(user: str) -> str:
    from app.auth.rbac import get_role

    return get_role(user) or "user"


def fetch_ticket_context(user: str, query: str) -> tuple[str, list[dict]]:
    """Return (LLM context, structured rows) scoped by RBAC. ('' , []) if nothing found."""
    privileged = _role_of(user) in ("admin", "agent")

    where = "WHERE created_by = :user" if not privileged else ""
    params: dict = {"user": user, "limit": 10}

    specific = _TICKET_ID.search(query)
    if specific:
        where = "WHERE jira_key = :key"
        params = {"key": specific.group(0).upper(), "user": user, "limit": 10}
        if not privileged:
            where += " AND created_by = :user"

    sql = text(
        "SELECT id, jira_key, subject, description, domain, status, priority, "
        "created_by, created_at FROM jira_tickets "
        + where
        + " ORDER BY created_at DESC LIMIT :limit"
    )

    try:
        with SessionLocal() as s:
            rows = s.execute(sql, params).mappings().all()
    except Exception:
        return "", []

    if not rows:
        if specific:
            return (
                f"No ticket {specific.group(0).upper()} found"
                + ("" if privileged else f" for user {user}.")
                + " Ticket data is not part of the knowledge base."
            ), []
        return "", []

    lines = ["Current IT ticket records (live from the ticketing system):"]
    ticket_rows = []
    for r in rows:
        key = r.get("jira_key") or f"IT-{r['id']}"
        created = r["created_at"].strftime("%b %d, %Y %H:%M") if r.get("created_at") else "unknown"
        subject = r.get("subject") or f"{(r.get('domain') or 'general')} escalation"
        lines.append(
            f"- {key}: [{r.get('status') or 'open'}] {subject} "
            f"(priority: {r.get('priority') or 'medium'}; "
            f"created by {r.get('created_by')} at {created})"
        )
        ticket_rows.append({
            "page_id": key,
            "title": subject,
            "domain": r.get("domain") or "tickets",
            "source_url": (SETTINGS.jira_base_url.rstrip("/") + "/browse/" + key)
                if SETTINGS.jira_base_url else "",
            "content": f"{r.get('status') or 'open'} ticket · priority {r.get('priority') or 'medium'} · created by {r.get('created_by')} at {created}",
            "relevance": None,  # set by caller
        })
    lines.append(
        "Answer the user's question using ONLY these records. "
        "If the answer is not among them, say so."
    )
    return "\n".join(lines), ticket_rows
