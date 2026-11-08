"""Jira reconciliation rules.

The whole risk of reconciliation is deleting the wrong thing: an outage, a rejected token or
a 500 must never look like "this ticket was deleted in Jira". These tests pin each answer
Jira can give to the write it is allowed to cause — and nothing more.
"""
from __future__ import annotations

from app.integrations.jira_reconcile import decide
from app.integrations.ticket_status import canonical_from_jira_status as canon


ROWS = [
    {"id": 1, "jira_key": "ITHD-1", "status": "open"},
    {"id": 2, "jira_key": "ITHD-2", "status": "open"},
    {"id": 3, "jira_key": "ITHD-3", "status": "open"},
    {"id": 4, "jira_key": "ITHD-4", "status": "deleted"},
]


def test_a_404_is_the_only_thing_that_deletes_a_row():
    plan = decide(ROWS[:1], {"ITHD-1": {"ok": False, "missing": True}}, canon)
    assert plan["delete"] == [1]
    assert plan["missing"] == ["ITHD-1"]
    assert plan["status"] == {}


def test_an_unreachable_jira_changes_nothing():
    plan = decide(ROWS[:1], {"ITHD-1": {"ok": False, "detail": "ConnectError: timeout"}}, canon)
    assert plan["delete"] == []
    assert plan["status"] == {}
    assert plan["unreachable"] == 1


def test_a_live_status_is_adopted_only_when_it_differs():
    plan = decide(
        [ROWS[0], ROWS[1]],
        {
            "ITHD-1": {"ok": True, "status": "Done"},          # open -> done
            "ITHD-2": {"ok": True, "status": "Open"},          # unchanged
        },
        canon,
    )
    assert plan["status"] == {"done": [1]}
    assert plan["delete"] == []


def test_a_ticket_that_reappears_is_revived_and_restatused():
    plan = decide(
        [ROWS[3]],
        {"ITHD-4": {"ok": True, "status": "In Progress"}},
        canon,
    )
    assert plan["revive"] == [4]
    assert plan["status"] == {"in_progress": [4]}


def test_rows_without_a_jira_key_are_not_checked():
    plan = decide([{"id": 9, "jira_key": None, "status": "open"}], {}, canon)
    assert plan["checked"] == 0
    assert plan["delete"] == [] and plan["status"] == {}


def test_the_jira_fetch_treats_404_as_missing_not_as_an_error():
    import inspect

    from app.integrations import jira

    source = inspect.getsource(jira.fetch_issue_status)
    assert 'status_code == 404' in source
    assert '"missing": True' in source


def test_the_board_hides_tickets_marked_deleted():
    import inspect

    from app.api import tickets

    source = inspect.getsource(tickets.list_tickets)
    assert "'deleted'" in source


def test_nightly_reconciliation_is_scheduled_and_exposed():
    from app.api import tickets
    from workers.celery_app import celery_app

    schedule = celery_app.conf.beat_schedule
    assert "reconcile-jira" in schedule
    assert schedule["reconcile-jira"]["task"] == "workers.sync_tasks.reconcile_jira"

    paths = {r.path for r in tickets.router.routes}
    assert "/api/tickets/reconcile" in paths
