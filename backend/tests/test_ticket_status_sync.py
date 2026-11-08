"""Ticket status: one terminal Jira state, and the board must not drift from it.

Live project ITHD has a single terminal status ("Done") and, once there, the only available
transition is "Reopen issue". So:

  * asking for `closed` on a Done issue is an accepted no-op, not a failure,
  * a refused transition must leave the local row untouched (no optimistic write),
  * a row the operator closed must survive the next pull instead of flipping to `resolved`.
"""
from __future__ import annotations

import inspect

from app.api import tickets as tickets_api
from app.integrations import jira as jira_mod
from app.integrations import jira_reconcile
from app.integrations.ticket_status import canonical_from_jira_status, is_terminal


def test_resolved_and_closed_are_one_upstream_state():
    assert canonical_from_jira_status("Done") == "resolved"
    assert canonical_from_jira_status("Closed") == "closed"
    assert is_terminal("resolved") and is_terminal("closed")
    assert not is_terminal("pending")


def test_closing_an_already_done_issue_is_a_no_op_not_a_transition_hunt(monkeypatch):
    monkeypatch.setattr(jira_mod, "fetch_issue_status",
                        lambda key: {"ok": True, "status": "done", "assignee": None})
    # Any attempt to list/post transitions would raise here: there is nothing to transition.
    monkeypatch.setattr(jira_mod, "_jira_cfg",
                        lambda: {"base_url": "https://example.atlassian.net",
                                 "email": "a@b.c", "api_token": "x", "project": "ITHD"})

    out = jira_mod.transition_issue("ITHD-36", "closed")
    assert out["ok"] is True
    assert "already" in out["detail"]


def test_setting_the_status_it_already_has_is_a_no_op(monkeypatch):
    monkeypatch.setattr(jira_mod, "fetch_issue_status",
                        lambda key: {"ok": True, "status": "Pending", "assignee": None})
    monkeypatch.setattr(jira_mod, "_jira_cfg",
                        lambda: {"base_url": "https://example.atlassian.net",
                                 "email": "a@b.c", "api_token": "x", "project": "ITHD"})
    out = jira_mod.transition_issue("ITHD-1", "open")
    assert out["ok"] is True
    assert "already" in out["detail"]


def test_a_status_change_is_pushed_to_jira_before_the_local_write():
    source = inspect.getsource(tickets_api.ticket_update)
    push = source.index("transition_issue(row.jira_key, req.status)")
    write = source.index("with SessionLocal() as s:")
    assert push < write, "the local status is committed before Jira agrees"


def test_a_refused_transition_is_a_409_with_the_reason():
    source = inspect.getsource(tickets_api.ticket_update)
    assert "HTTP_409_CONFLICT" in source
    assert "Jira refused the status change" in source


def test_reconcile_does_not_pull_a_closed_row_back_to_resolved():
    rows = [{"id": 7, "jira_key": "ITHD-36", "status": "closed"}]
    results = {"ITHD-36": {"ok": True, "status": "done"}}
    plan = jira_reconcile.decide(rows, results, canonical_from_jira_status)
    assert plan["status"] == {}, plan


def test_reconcile_still_applies_a_real_reopen():
    rows = [{"id": 7, "jira_key": "ITHD-36", "status": "closed"}]
    results = {"ITHD-36": {"ok": True, "status": "Reopened"}}
    plan = jira_reconcile.decide(rows, results, canonical_from_jira_status)
    assert plan["status"] == {"open": [7]}, plan


def test_a_locally_closed_row_is_not_pulled_back_by_a_list_read():
    # Jira's Done is dynamic: it maps to "resolved". Every board refresh used to rewrite a
    # closed row as resolved, so "Closed" never appeared to stick.
    assert tickets_api._respect_local_closed("closed", "resolved") == "closed"
    assert tickets_api._respect_local_closed("pending", "resolved") == "resolved"
    assert tickets_api._respect_local_closed("closed", "open") == "open"
