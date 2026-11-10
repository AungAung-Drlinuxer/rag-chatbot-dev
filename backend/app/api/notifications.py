"""One notification feed for the bell (v1.0.57).

The bell used to poll two admin-only endpoints from the browser, so:

* a normal user never received a notification of any kind,
* any failure of those two calls was swallowed and rendered as "You're all caught up" —
  which is what a 429 burst looked like from the outside,
* the sources were hard-coded in the component, so a new event had nowhere to go.

This endpoint answers "what happened that concerns me?" in one round trip, scoped to the
caller. It derives the feed from tables that already exist — no notification table, no
fan-out writes, nothing to keep in sync.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Body, Depends
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role
from app.persistence.database import SessionLocal

logger = logging.getLogger("notifications")

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

MAX_ITEMS = 20
DECIDED_WINDOW_DAYS = 14

# What the user may switch off in Settings → Notifications. Absent means "on": a missing
# pref must never silently hide a pending approval.
PREF_DEFAULTS = {
    "notifyApprovals": True,   # work waiting on an admin/agent decision
    "notifyTickets": True,     # my escalations decided, my tickets created
    "notifyAccounts": True,    # accounts awaiting approval (admins)
}


def _prefs(user: str) -> dict:
    """The three notification switches, read from user_settings.prefs (JSONB)."""
    try:
        with SessionLocal() as s:
            row = s.execute(
                text("SELECT prefs FROM user_settings WHERE username = :u"), {"u": user}
            ).scalar()
    except Exception:  # noqa: BLE001 - a missing row is the normal first-visit case
        row = None
    if isinstance(row, str):
        try:
            import json
            row = json.loads(row)
        except Exception:  # noqa: BLE001
            row = None
    out = dict(PREF_DEFAULTS)
    if isinstance(row, dict):
        for k in PREF_DEFAULTS:
            v = row.get(k)
            if isinstance(v, bool):
                out[k] = v
    return out


_DDL = """
CREATE TABLE IF NOT EXISTS notification_dismissals (
    username     VARCHAR(64) NOT NULL,
    item_id      VARCHAR(64) NOT NULL,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (username, item_id)
)
"""


def _ensure_table(s) -> None:
    """create_all covers a fresh install; this covers a cluster that predates the table."""
    s.execute(text(_DDL))


def _dismissed(user: str) -> set[str]:
    try:
        with SessionLocal() as s:
            _ensure_table(s)
            s.commit()
            rows = s.execute(
                text("SELECT item_id FROM notification_dismissals WHERE username = :u"),
                {"u": user},
            ).scalars().all()
    except Exception as exc:  # noqa: BLE001 - table may not exist on a very old schema
        logger.warning("notification_dismissals unavailable: %s", exc)
        return set()
    return set(rows)


def _iso(value) -> str:
    return value.isoformat() if value else ""


@router.get("")
def notifications(user: str = Depends(get_current_user)) -> dict:
    """Newest-first feed for the caller. Empty list means "nothing concerns you" — the UI
    may only say "all caught up" when this call actually succeeded."""
    prefs = _prefs(user)
    dismissed = _dismissed(user)
    role = (get_role(user) or "user").lower()
    is_admin = role == "admin"
    is_agent = role in ("admin", "agent")
    since = datetime.now(UTC) - timedelta(days=DECIDED_WINDOW_DAYS)
    items: list[dict] = []

    with SessionLocal() as s:
        # 1. Work waiting on an admin/agent: escalations held for approval.
        if is_agent:
            rows = s.execute(text(
                "SELECT id, username, question, created_at FROM approvals "
                "WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10"
            )).mappings().all()
            for r in rows:
                items.append({
                    "id": f"ap-{r['id']}",
                    "kind": "approval",
                    "label": r["question"] or "Escalation awaiting approval",
                    "sub": f"HITL approval · {r['username']}",
                    "nav": "tickets",
                    "created_at": _iso(r["created_at"]),
                })

        # 2. My own escalations that have been decided — the answer to "what happened to
        #    the ticket I asked for?" that the requester never saw anywhere.
        rows = s.execute(text(
            "SELECT id, question, status, created_at FROM approvals "
            "WHERE username = :u AND status IN ('approved', 'rejected') AND created_at >= :since "
            "ORDER BY created_at DESC LIMIT 10"
        ), {"u": user, "since": since}).mappings().all()
        for r in rows:
            verdict = "approved" if r["status"] == "approved" else "not approved"
            items.append({
                "id": f"apd-{r['id']}",
                "kind": "info",
                "label": f"Your escalation was {verdict}",
                "sub": (r["question"] or "")[:70],
                "nav": "chat",
                "created_at": _iso(r["created_at"]),
            })

        # 3. Tickets that exist because of something I escalated.
        rows = s.execute(text(
            "SELECT id, jira_key, jira_link, payload->>'summary' AS summary, submitted_at "
            "FROM escalation_drafts WHERE username = :u AND jira_key IS NOT NULL "
            "ORDER BY submitted_at DESC NULLS LAST LIMIT 10"
        ), {"u": user}).mappings().all()
        for r in rows:
            items.append({
                "id": f"esc-{r['id']}",
                "kind": "info",
                "label": f"Ticket {r['jira_key']} created",
                "sub": (r["summary"] or "")[:70],
                "nav": "tickets",
                "created_at": _iso(r["submitted_at"]),
            })

        # 4. Accounts waiting for an admin decision.
        if is_admin:
            rows = s.execute(text(
                "SELECT username FROM users WHERE lower(status) = 'pending' ORDER BY id LIMIT 10"
            )).mappings().all()
            for r in rows:
                items.append({
                    "id": f"ldap-{r['username']}",
                    "kind": "ldap",
                    "label": f"{r['username']} awaiting approval",
                    "sub": "LDAP gate",
                    "nav": "users",
                    "created_at": "",
                })

    if not prefs["notifyApprovals"]:
        items = [i for i in items if i["kind"] != "approval"]
    if not prefs["notifyAccounts"]:
        items = [i for i in items if i["kind"] != "ldap"]
    if not prefs["notifyTickets"]:
        items = [i for i in items if i["kind"] not in ("info",)]
    items = [i for i in items if i["id"] not in dismissed]

    items.sort(key=lambda i: i["created_at"] or "", reverse=True)
    return {
        "notifications": items[:MAX_ITEMS],
        "generated_at": datetime.now(UTC).isoformat(),
        "role": role,
        "prefs": prefs,
    }


@router.post("/clear")
def clear_notifications(
    payload: dict | None = Body(default=None),
    user: str = Depends(get_current_user),
) -> dict:
    """Clear the feed the user is looking at.

    The feed is derived, so there is nothing to delete — the ids it is showing are recorded as
    dismissed for this user and filtered out of every later response. With no `ids`, everything
    currently in the caller's feed is dismissed (the "Clear all" button); passing ids lets the
    UI clear a subset without racing a poll that arrived in between.
    """
    ids = (payload or {}).get("ids")
    if ids is None:
        ids = [i["id"] for i in notifications(user=user)["notifications"]]
    ids = [str(i)[:64] for i in (ids or []) if str(i).strip()]
    if not ids:
        return {"cleared": 0}

    with SessionLocal() as s:
        _ensure_table(s)
        for item_id in ids:
            s.execute(text(
                "INSERT INTO notification_dismissals (username, item_id) VALUES (:u, :i) "
                "ON CONFLICT (username, item_id) DO NOTHING"
            ), {"u": user, "i": item_id})
        s.commit()
    logger.info("cleared %d notification(s) for %s", len(ids), user)
    return {"cleared": len(ids)}
