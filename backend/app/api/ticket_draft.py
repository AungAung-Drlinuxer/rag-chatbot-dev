from __future__ import annotations

"""Draft a Jira ticket from a chat answer.

The reporter has already explained the problem in the chat; asking them to retype it into a
create form is the part people abandon. This endpoint reads the question + answer and returns
the fields the create API can actually honour, so the card in the chat is a review, not a form.

Rules that matter more than the model:
- `domain` must be one of the deployment's live classifier domains — an invented category is
  silently re-routed to "general" later, and the ticket lands in the wrong queue.
- `due_date` must be an ISO date inside a sane horizon, or null. Models love "next Monday".
- Nothing is created here. The endpoint is pure: same input, same shape, no rows written.
"""

import json
import logging
import re
from datetime import date, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.deps import get_current_user
from app.auth.rbac import require_cap

logger = logging.getLogger("dashboard")

router = APIRouter(prefix="/api")

_PRIORITIES = {"low", "medium", "high", "critical"}


class TicketDraftRequest(BaseModel):
    question: str = ""
    answer: str = ""
    domain: str | None = None
    session_id: str | None = None


def _live_domains() -> list[dict[str, str]]:
    from app.persistence.models import ClassifierDomain
    from app.persistence.database import SessionLocal

    try:
        with SessionLocal() as s:
            rows = (
                s.query(ClassifierDomain)
                .filter(ClassifierDomain.is_active.is_(True))
                .order_by(ClassifierDomain.display_name.asc())
                .all()
            )
            return [{"key": d.domain_key, "label": d.display_name} for d in rows]
    except Exception as exc:  # noqa: BLE001 — a draft is still useful without the dropdown
        logger.warning("ticket draft: domain list unavailable: %s", exc)
        return []


def _extract_json(text: str) -> dict[str, Any] | None:
    """Models wrap JSON in prose or fences often enough that a strict json.loads is not enough."""
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S)
    if fence:
        raw = fence.group(1)
    else:
        start, end = raw.find("{"), raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _clean_date(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return None
    try:
        d = date.fromisoformat(text)
    except ValueError:
        return None
    today = date.today()
    if d < today or d > today + timedelta(days=365):
        return None
    return d.isoformat()


def _clean_priority(value: Any) -> str:
    p = str(value or "").strip().lower()
    return p if p in _PRIORITIES else "medium"


def _clean_domain(value: Any, live: list[dict[str, str]], fallback: str | None) -> str:
    key = str(value or "").strip().lower()
    allowed = {d["key"] for d in live}
    if key and (not allowed or key in allowed):
        return key
    fb = str(fallback or "").strip().lower()
    if fb and (not allowed or fb in allowed):
        return fb
    return live[0]["key"] if live else "general"


@router.post("/tickets/draft")
def draft_ticket(
    req: TicketDraftRequest,
    user: str = Depends(get_current_user),
    _cap: str = Depends(require_cap("create_tickets")),
) -> dict:
    """Read the chat turn and return a reviewable ticket draft (no side effects)."""
    question = (req.question or "").strip()[:4000]
    answer = (req.answer or "").strip()[:6000]
    if not question and not answer:
        raise HTTPException(status_code=400, detail="Nothing to read — the conversation is empty.")

    live = _live_domains()
    domain_menu = ", ".join(f'{d["key"]} ({d["label"]})' for d in live) or "general"

    from app.orchestration.orchestrator import answer_chain

    prompt = (
        "You turn an IT support conversation into a Jira Service Management ticket.\n"
        "Read the reporter's question and the assistant's answer, then return ONE JSON object:\n"
        '  "subject": a single line, at most 110 characters, naming the broken thing and the '
        "symptom. No greeting, no ticket prefix, no trailing period.\n"
        '  "description": 3-6 short lines for the engineer who will pick this up. State the '
        "symptom, the impact, what was already tried, and the next action. Use only facts present "
        "in the conversation; never invent an error code, hostname, person, time or step.\n"
        '  "priority": one of low, medium, high, critical. Critical only when production is down '
        "for many people; high when the reporter is blocked.\n"
        '  "domain": one of these keys exactly: ' + domain_menu + ".\n"
        '  "assignee": a username only if the conversation names one, else null.\n'
        '  "due_date": YYYY-MM-DD only if the conversation states a deadline, else null.\n'
        "Return JSON only — no prose, no markdown fences.\n\n"
        f"Reporter's question:\n{question or '(not given)'}\n\n"
        f"Assistant's answer:\n{answer or '(not given)'}\n"
    )

    try:
        chain = answer_chain()
        if chain is None:
            raise HTTPException(status_code=503, detail="AI assist is not configured — no model key is set.")
        payload = {"context": "(drafting a ticket from the transcript above)", "question": prompt}
        text = ""
        for _ in range(2):
            text = str(chain.invoke(payload) or "").strip()
            if text:
                break
        data = _extract_json(text)
        if not data:
            raise HTTPException(status_code=503, detail="The model did not return a blueprint — try again.")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("ticket draft failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Draft failed: {type(exc).__name__}")

    subject = " ".join(str(data.get("subject") or "").split())[:110]
    description = str(data.get("description") or "").strip()[:4000]
    if not subject:
        raise HTTPException(status_code=422, detail="The model produced no subject — write one first.")

    return {
        "draft": {
            "subject": subject,
            "description": description,
            "priority": _clean_priority(data.get("priority")),
            "domain": _clean_domain(data.get("domain"), live, req.domain),
            "assignee": (str(data["assignee"]).strip() or None) if data.get("assignee") else None,
            "due_date": _clean_date(data.get("due_date")),
        },
        "domains": live,
        "source": {"session_id": req.session_id, "reporter": user},
    }
