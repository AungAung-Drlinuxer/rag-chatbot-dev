"""Editing a ticket writes the issue, and deleting an attachment deletes it in Jira too.

The board could previously change only its own row: a ticket whose summary said one thing here
and another in Jira was normal, and a "deleted" attachment stayed on the issue. These pin the
two directions — fields go up, attachments come down.
"""
from __future__ import annotations

import inspect
from typing import Any

import pytest

from app.api import tickets as tickets_api
from app.integrations import jira as jira_mod


class _Resp:
    def __init__(self, status: int, payload: Any):
        self.status_code = status
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class _FakeClient:
    calls: list[dict] = []
    response: _Resp = _Resp(204, {})

    def __init__(self, *a, **kw):
        _FakeClient.calls.append({})

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def put(self, url, **kw):
        _FakeClient.calls[-1].update({"method": "put", "url": url, **kw})
        return _FakeClient.response

    def delete(self, url, **kw):
        _FakeClient.calls[-1].update({"method": "delete", "url": url, **kw})
        return _FakeClient.response

    def get(self, url, **kw):
        _FakeClient.calls[-1].update({"method": "get", "url": url, **kw})
        return _FakeClient.response


@pytest.fixture(autouse=True)
def _fake(monkeypatch):
    _FakeClient.calls = []
    _FakeClient.response = _Resp(204, {})
    monkeypatch.setattr("httpx.Client", _FakeClient)
    monkeypatch.setattr(jira_mod, "_jira_cfg", lambda: {"base_url": "https://jira.example"})
    monkeypatch.setattr(jira_mod, "_auth_header", lambda: "Bearer x")
    yield


def test_fields_travel_in_one_put_with_jira_names():
    out = jira_mod.update_issue_fields(
        "ITHD-37", summary="jam cleared", description="line one\nline two",
        priority="urgent", due_date="2026-11-20",
    )
    assert out["ok"] is True
    call = _FakeClient.calls[-1]
    assert call["url"].endswith("/rest/api/3/issue/ITHD-37")
    fields = call["json"]["fields"]
    assert fields["summary"] == "jam cleared"
    assert fields["duedate"] == "2026-11-20"
    # "urgent" is this app's word; Jira's top priority is called Highest.
    assert fields["priority"] == {"name": "Highest"}
    # v3 rejects a plain string for description.
    assert call["headers"]["Authorization"] == "Bearer x"
    assert fields["description"]["type"] == "doc"
    assert len(fields["description"]["content"]) == 2


def test_only_the_fields_that_changed_are_sent():
    jira_mod.update_issue_fields("ITHD-37", priority="high")
    fields = _FakeClient.calls[-1]["json"]["fields"]
    assert set(fields) == {"priority"}


def test_a_refused_edit_says_why():
    _FakeClient.response = _Resp(400, {"errorMessages": [], "errors": {"duedate": "not a date"}})
    out = jira_mod.update_issue_fields("ITHD-37", due_date="soon")
    assert out["ok"] is False
    assert "duedate: not a date" in out["detail"]


def test_deleting_an_attachment_hits_the_attachment_endpoint():
    out = jira_mod.delete_attachment("10234")
    assert out["ok"] is True
    assert _FakeClient.calls[-1]["url"].endswith("/rest/api/3/attachment/10234")
    assert _FakeClient.calls[-1]["method"] == "delete"


def test_an_already_deleted_attachment_is_not_an_error():
    _FakeClient.response = _Resp(404, {})
    out = jira_mod.delete_attachment("10234")
    assert out["ok"] is True and out["already_gone"] is True


def test_the_update_schema_accepts_priority_and_comment():
    from app.api.tickets import TicketUpdateRequest

    req = TicketUpdateRequest(priority="high", comment="note")
    assert req.priority == "high" and req.comment == "note"


def test_the_put_handler_pushes_fields_before_writing_locally():
    source = inspect.getsource(tickets_api.ticket_update)
    push = source.index("update_issue_fields(")
    local_write = source.index("row.priority = req.priority")
    assert push < local_write


def test_the_attachment_delete_route_exists():
    from app.main import app

    paths = set(app.openapi()["paths"])
    assert "/api/tickets/{ticket_ref}/attachments/{att_id}" in paths
    methods = app.openapi()["paths"]["/api/tickets/{ticket_ref}/attachments/{att_id}"]
    assert "delete" in methods
