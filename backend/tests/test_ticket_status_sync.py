"""Ticket status must speak Jira's own workflow.

The ITHD project runs the JSM default workflow — OPEN / PENDING / WORK IN PROGRESS / DONE /
REOPENED — with DONE as the only terminal state. Two regressions must stay fixed:

  * `resolved`/`closed` are not Jira statuses; they were invented here, so "close" asked for a
    transition that never existed,
  * a status change must reach Jira before it is written locally, and a refusal must change
    nothing.
"""
from __future__ import annotations

import inspect

from app.api import tickets as tickets_api
from app.integrations import jira as jira_mod
from app.integrations import jira_reconcile
from app.integrations.ticket_status import (
    canonical_from_jira_status,
    canonical_statuses,
    is_terminal,
    normalise_status,
)


def test_the_board_uses_jiras_five_statuses():
    assert canonical_statuses() == ["open", "pending", "in_progress", "done", "reopened"]
    assert canonical_from_jira_status("OPEN") == "open"
    assert canonical_from_jira_status("Pending") == "pending"
    assert canonical_from_jira_status("Work in progress") == "in_progress"
    assert canonical_from_jira_status("Done") == "done"
    assert canonical_from_jira_status("Reopened") == "reopened"
    assert canonical_from_jira_status("Something new") == "open"


def test_only_done_is_terminal_and_legacy_names_read_as_done():
    assert is_terminal("done") and is_terminal("resolved") and is_terminal("closed")
    assert not is_terminal("pending") and not is_terminal("reopened")
    assert normalise_status("resolved") == "done"
    assert normalise_status("closed") == "done"
    assert normalise_status(None) == "open"


def test_asking_for_the_current_status_is_a_no_op(monkeypatch):
    monkeypatch.setattr(jira_mod, "fetch_issue_status",
                        lambda key: {"ok": True, "status": "Pending", "assignee": None})
    cfg = {"base_url": "https://example.atlassian.net", "email": "a@b.c",
           "api_token": "x", "project": "ITHD"}
    monkeypatch.setattr(jira_mod, "_jira_cfg", lambda: cfg)

    out = jira_mod.transition_issue("ITHD-1", "pending")
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


def test_reconcile_adopts_a_status_change():
    rows = [{"id": 7, "jira_key": "ITHD-36", "status": "open"}]
    results = {"ITHD-36": {"ok": True, "status": "Done"}}
    plan = jira_reconcile.decide(rows, results, canonical_from_jira_status)
    assert plan["status"] == {"done": [7]}, plan


def test_reconcile_does_not_rewrite_a_row_that_already_matches():
    rows = [{"id": 7, "jira_key": "ITHD-36", "status": "resolved"}]  # legacy row, same meaning
    results = {"ITHD-36": {"ok": True, "status": "Done"}}
    plan = jira_reconcile.decide(rows, results, canonical_from_jira_status)
    assert plan["status"] == {}, plan


def test_reconcile_still_applies_a_reopen():
    rows = [{"id": 7, "jira_key": "ITHD-36", "status": "done"}]
    results = {"ITHD-36": {"ok": True, "status": "Reopened"}}
    plan = jira_reconcile.decide(rows, results, canonical_from_jira_status)
    assert plan["status"] == {"reopened": [7]}, plan
