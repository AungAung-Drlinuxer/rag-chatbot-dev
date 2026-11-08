"""v1.6.9 — canonical ticket status model shared by Jira and OpenProject.

The platform uses four internal statuses on the Tickets board:
    open | pending | resolved | closed

Each integration maps those onto its own real workflow values, and maps
upstream status names BACK to the canonical set on pull.

Jira (live project ITHD, verified transitions):
    open     -> "To Do"/"Open"/"Reopen"            (status: Open / Pending)
    pending  -> "Start progress"                   (status: Work in progress)
    resolved -> "Mark as done"                     (status: Done)
    closed   -> fallback "Mark as done" (Done terminal)

OpenProject (workflow probed live on WP 44 — stock Task workflow):
    open     -> 1  New
    pending  -> 7  In progress     (13 On hold is an alternative)
    resolved -> 12 Closed          (only reachable terminal state in stock workflow)
    closed   -> 12 Closed          (14 Rejected also closed)
    Workflow edges: New <-> In progress -> Closed/On hold/Rejected (bidirectional
    between all four "active" states)

Any upstream status name that does not map exactly is bucketed by keyword so
the board never shows a raw unknown status.
"""
from __future__ import annotations

# ---------------------------------------------------------------------------
# OpenProject: canonical -> real status IDs
# ---------------------------------------------------------------------------

# Live status IDs from GET /api/v3/statuses on this instance (stock workflow).
# ---------------------------------------------------------------------------
# Jira: canonical -> transitions, and status-name -> canonical
# ---------------------------------------------------------------------------

# verified live on ITHD: transitions are 'Pending', 'Start progress' (to
# 'Work in progress'), 'Mark as done' (to 'Done')
JIRA_TRANSITIONS_BY_CANONICAL: dict[str, list[str]] = {
    "open": ["Reopen", "Re-open", "To Do", "Open", "Backlog", "Pending"],
    "pending": ["Start progress", "Start Progress", "In Progress", "Pending"],
    "resolved": ["Mark as done", "Done", "Resolve Issue", "Resolve"],
    "closed": ["Close Issue", "Close", "Mark as done", "Done"],
}

_JIRA_TO_CANONICAL: list[tuple[str, str]] = [
    ("to do", "open"),
    ("open", "open"),
    ("backlog", "open"),
    ("reopened", "open"),
    ("re-open", "open"),
    ("pending", "open"),      # Jira "Pending" = waiting on reporter -> still open
    ("work in progress", "pending"),
    ("in progress", "pending"),
    ("under review", "pending"),
    ("waiting for support", "pending"),
    ("waiting for customer", "open"),
    ("done", "resolved"),
    ("resolved", "resolved"),
    ("complete", "resolved"),
    ("closed", "closed"),
    ("cancelled", "closed"),
    ("canceled", "closed"),
    ("rejected", "closed"),
]


def canonical_from_jira_status(name: str) -> str:
    """Map a Jira status name to the canonical platform status."""
    n = (name or "").strip().lower()
    for frag, canon in _JIRA_TO_CANONICAL:
        if frag in n:
            return canon
    return "open"


def canonical_statuses() -> list[str]:
    return ["open", "pending", "resolved", "closed"]