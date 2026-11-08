"""Canonical ticket status model — mirrors the Jira project's real workflow.

The ITHD project runs the JSM default workflow:

    Create → OPEN → PENDING / WORK IN PROGRESS → DONE → REOPENED

so the board uses exactly those five statuses (`open`, `pending`, `in_progress`, `done`,
`reopened`). Earlier versions invented `resolved` and `closed`, which this Jira project never
has: closing meant asking for a transition that does not exist, and every refresh rewrote the
local `closed` back to `resolved`.

Rules
-----
* `DONE` is the only terminal status; `resolved`/`closed` are legacy aliases migrated on start.
* An unknown upstream status falls back to `open`, never to a raw new value.
* Asking for the status an issue already has is an accepted no-op, not a failed transition.
"""
from __future__ import annotations

# canonical -> acceptable Jira transition names (first match wins)
JIRA_TRANSITIONS_BY_CANONICAL: dict[str, list[str]] = {
    "open": ["Open", "reopen issue", "Reopen", "Re-open"],
    "pending": ["Pending"],
    "in_progress": ["Start progress", "Start Progress", "In Progress", "In progress"],
    "done": ["Mark as done", "Done", "Resolve Issue", "Resolve"],
    "reopened": ["Reopen issue", "Reopen", "Re-open"],
}

# Jira status name (lowercased substring) -> canonical. Order matters: "reopened" before
# "open", "work in progress" before "in progress"-ish fragments.
_JIRA_TO_CANONICAL: list[tuple[str, str]] = [
    ("reopened", "reopened"),
    ("re-open", "reopened"),
    ("pending", "pending"),
    ("work in progress", "in_progress"),
    ("in progress", "in_progress"),
    ("under review", "in_progress"),
    ("waiting for support", "pending"),
    ("waiting for customer", "pending"),
    ("done", "done"),
    ("resolved", "done"),
    ("complete", "done"),
    ("closed", "done"),
    ("cancelled", "done"),
    ("canceled", "done"),
    ("rejected", "done"),
    ("to do", "open"),
    ("backlog", "open"),
    ("open", "open"),
]

#: The only status that means "this workflow is finished".
TERMINAL_STATUSES = frozenset({"done"})

#: Statuses written by older releases. Read as their canonical equivalent, migrated on start.
LEGACY_STATUS_ALIASES: dict[str, str] = {"resolved": "done", "closed": "done"}


def canonical_from_jira_status(name: str) -> str:
    """Map a Jira status name to the canonical platform status."""
    n = (name or "").strip().lower()
    for frag, canon in _JIRA_TO_CANONICAL:
        if frag in n:
            return canon
    return "open"


def normalise_status(status: str | None) -> str:
    """Canonicalise anything stored, including legacy `resolved`/`closed`."""
    s = (status or "").strip().lower()
    if not s:
        return "open"
    return LEGACY_STATUS_ALIASES.get(s, s)


def is_terminal(status: str) -> bool:
    return normalise_status(status) in TERMINAL_STATUSES


def canonical_statuses() -> list[str]:
    return ["open", "pending", "in_progress", "done", "reopened"]
