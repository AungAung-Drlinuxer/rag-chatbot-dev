"""Jira reconciliation — make the mirror match Jira, including issues that no longer exist.

WHY THIS EXISTS
---------------
`jira_tickets` is a MIRROR of Jira, filled at escalation time and refreshed on read. Neither
path can ever learn that an issue was deleted in Jira: a read only ever looks up keys the
mirror already has, so a deleted issue keeps answering 200 here until someone notices the
board is wrong.

Reconciliation is the missing direction: for every stored key ask Jira whether the issue still
exists, then
  * issue gone  -> mark the row `deleted` with the time we noticed (kept, not erased: an
    operator may need to know an escalation existed even though the ticket was removed),
  * issue there -> adopt Jira's canonical status, and clear a previous `deleted` mark,
  * Jira unreachable / not configured -> change NOTHING. A network error is not evidence that
    a ticket was deleted, and deleting the board on an outage would be worse than stale data.

The `decide()` step is pure so the rules can be tested without a database or a live Jira.
"""
from __future__ import annotations

from sqlalchemy import text

from app.integrations.ticket_status import normalise_status as normalise

DELETED_STATUS = "deleted"


def decide(
    rows: list[dict], results: dict[str, dict], canonicalise
) -> dict:
    """Turn per-key Jira answers into the writes to apply.

    rows:      [{id, jira_key, status}] straight from the mirror.
    results:   {jira_key: {"ok": bool, "status": str, "missing": bool, "detail": str}}.
    canonicalise: Jira status name -> canonical status (open|pending|in_progress|done|reopened).

    Returns {"delete": [ids], "revive": [ids], "status": {status: [ids]}, "missing": [keys],
             "unreachable": n, "checked": n}.
    """
    delete: list[int] = []
    revive: list[int] = []
    by_status: dict[str, list[int]] = {}
    missing: list[str] = []
    unreachable = 0
    checked = 0

    for row in rows:
        key = row.get("jira_key")
        if not key:
            continue
        checked += 1
        answer = results.get(key) or {}
        if answer.get("missing"):
            delete.append(int(row["id"]))
            missing.append(key)
            continue
        if not answer.get("ok"):
            # Not configured, 401, timeout, 500 — all "we do not know", never "gone".
            unreachable += 1
            continue
        target = canonicalise(answer.get("status") or "")
        target = normalise(target)
        was_deleted = (row.get("status") or "").lower() == DELETED_STATUS
        if was_deleted:
            revive.append(int(row["id"]))
        current = normalise(row.get("status"))
        if target and target != current:
            by_status.setdefault(target, []).append(int(row["id"]))

    return {
        "delete": delete,
        "revive": revive,
        "status": by_status,
        "missing": missing,
        "unreachable": unreachable,
        "checked": checked,
    }


def reconcile_jira(limit: int = 200, fetch=None) -> dict:
    """Ask Jira about every mirrored key and apply `decide()`. Idempotent, safe to re-run."""
    from app.integrations.jira import fetch_issue_status
    from app.integrations.ticket_status import canonical_from_jira_status
    from app.persistence.database import SessionLocal

    fetch = fetch or fetch_issue_status
    limit = max(1, min(int(limit or 200), 500))

    with SessionLocal() as s:
        rows = [dict(r) for r in s.execute(text(
            "SELECT id, jira_key, status FROM jira_tickets "
            "WHERE jira_key IS NOT NULL AND jira_key <> '' "
            "ORDER BY created_at DESC LIMIT :n"
        ), {"n": limit}).mappings()]

        results: dict[str, dict] = {}
        for key in {r["jira_key"] for r in rows}:
            results[key] = fetch(key)

        plan = decide(rows, results, canonical_from_jira_status)

        if plan["delete"]:
            s.execute(text(
                "UPDATE jira_tickets SET status = :d, remote_missing_at = NOW() "
                "WHERE id = ANY(:ids)"
            ), {"d": DELETED_STATUS, "ids": plan["delete"]})
        for status, ids in plan["status"].items():
            s.execute(text(
                "UPDATE jira_tickets SET status = :s, remote_missing_at = NULL "
                "WHERE id = ANY(:ids)"
            ), {"s": status, "ids": ids})
        if plan["revive"]:
            s.execute(text(
                "UPDATE jira_tickets SET remote_missing_at = NULL WHERE id = ANY(:ids)"
            ), {"ids": plan["revive"]})
        s.commit()

    return {
        "checked": plan["checked"],
        "missing": len(plan["missing"]),
        "missing_keys": plan["missing"][:20],
        "updated": sum(len(ids) for ids in plan["status"].values()),
        "revived": len(plan["revive"]),
        "unreachable": plan["unreachable"],
    }
