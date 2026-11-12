"""Comments and attachments must land on the Jira issue, not just in this app.

Two regressions are pinned here:

  * an attachment used to be stored in Postgres only — invisible to whoever works the ticket
    in Jira (and any large file died in the browser before the request left),
  * a comment posted from the panel never reached the tracker either.

The upload path is the one with a non-obvious requirement: Jira's multipart endpoint answers
403 unless `X-Atlassian-Token: no-check` is sent (its XSRF guard).
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
    response: _Resp
    get_payload: list = []

    def __init__(self, *a, **kw):
        self.headers = kw.get("headers") or {}
        _FakeClient.calls.append({"headers": self.headers})

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, **kw):
        _FakeClient.calls[-1].update({"url": url, **kw})
        return _FakeClient.response

    def get(self, url, **kw):
        _FakeClient.calls[-1].update({"get_url": url, **kw})
        return _Resp(200, _FakeClient.get_payload)

    def put(self, url, **kw):
        _FakeClient.calls[-1].update({"put_url": url, **kw})
        return _Resp(204, {})


@pytest.fixture()
def configured(monkeypatch):
    monkeypatch.setattr(jira_mod, "_jira_cfg", lambda: {
        "base_url": "https://example.atlassian.net", "email": "a@b.c",
        "api_token": "x", "project": "ITHD",
    })
    monkeypatch.setattr(jira_mod, "_auth_header", lambda: "Basic abc")
    _FakeClient.calls = []
    return monkeypatch


def test_upload_attachment_satisfies_jiras_xsrf_requirement(configured):
    import httpx

    _FakeClient.response = _Resp(200, [{"id": "10001", "filename": "photo.png"}])
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.upload_attachment("ITHD-36", "photo.png", b"\x89PNG", "image/png")

    assert out["ok"] is True
    assert out["filename"] == "photo.png"
    call = _FakeClient.calls[0]
    assert call["headers"]["X-Atlassian-Token"] == "no-check"
    assert call["url"].endswith("/rest/api/3/issue/ITHD-36/attachments")
    assert call["files"]["file"][0] == "photo.png"


def test_upload_attachment_reports_the_http_failure(configured):
    import httpx

    _FakeClient.response = _Resp(403, {"error": "XSRF check failed"})
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.upload_attachment("ITHD-36", "a.txt", b"x", "text/plain")
    assert out["ok"] is False
    assert "403" in out["detail"]


def test_add_comment_sends_an_adf_document(configured):
    import httpx

    _FakeClient.response = _Resp(201, {"id": "77"})
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.add_comment("ITHD-36", "Replaced the drum unit.")
    assert out["ok"] is True and out["id"] == "77"
    assert out["internal"] is False
    body = _FakeClient.calls[0]["json"]["body"]
    assert body["type"] == "doc"
    assert body["content"][0]["content"][0]["text"] == "Replaced the drum unit."
    # A public reply must not carry any agent-only marker.
    assert "properties" not in _FakeClient.calls[0]["json"]


def test_an_internal_note_goes_through_the_jsm_endpoint_as_non_public(configured):
    import httpx

    _FakeClient.response = _Resp(201, {"id": "88"})
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.add_comment("ITHD-36", "Checking the gateway logs.", internal=True)

    assert out["ok"] is True and out["internal"] is True
    call = _FakeClient.calls[0]
    assert call["url"].endswith("/rest/servicedeskapi/request/ITHD-36/comment")
    assert call["json"] == {"body": "Checking the gateway logs.", "public": False}


def test_an_internal_note_falls_back_to_role_visibility(configured):
    """No service-desk request: the note is restricted to a role the author holds."""
    import httpx

    class _SDRefuses(_FakeClient):
        def post(self, url, **kw):
            _FakeClient.calls.append({"url": url, "json": kw.get("json")})
            if "servicedeskapi" in url:
                return _Resp(404, {"errorMessages": ["no such request"]})
            return _Resp(201, {"id": "99"})

    configured.setattr(httpx, "Client", _SDRefuses)
    configured.setattr(jira_mod, "internal_roles", lambda: ["Service Desk Team", "Administrators"])

    out = jira_mod.add_comment("ITHD-36", "Internal only.", internal=True)

    assert out["ok"] is True and out["via"] == "role:Service Desk Team"
    assert _FakeClient.calls[-1]["json"]["visibility"] == {
        "type": "role", "value": "Service Desk Team"}


def test_an_internal_note_skips_a_role_the_author_does_not_hold(configured):
    import httpx

    class _RoleSkip(_FakeClient):
        def post(self, url, **kw):
            _FakeClient.calls.append({"url": url, "json": kw.get("json")})
            if "servicedeskapi" in url:
                return _Resp(404, {"errorMessages": ["no such request"]})
            if (kw.get("json") or {}).get("visibility", {}).get("value") == "Service Desk Team":
                return _Resp(400, {"errors": {
                    "commentLevel": "You are currently not a member of the project role: Service Desk Team."}})
            return _Resp(201, {"id": "100"})

    configured.setattr(httpx, "Client", _RoleSkip)
    configured.setattr(jira_mod, "internal_roles", lambda: ["Service Desk Team", "Administrators"])

    out = jira_mod.add_comment("ITHD-36", "Internal only.", internal=True)

    assert out["ok"] is True and out["via"] == "role:Administrators"


def test_internal_roles_are_deduplicated_and_configurable(monkeypatch):
    monkeypatch.delenv("JIRA_INTERNAL_ROLE", raising=False)
    assert jira_mod.internal_roles()[:2] == ["Service Desk Team", "Administrators"]
    monkeypatch.setenv("JIRA_INTERNAL_ROLE", "Administrators")
    assert jira_mod.internal_roles() == ["Administrators"]


def test_an_empty_comment_is_not_sent(configured):
    out = jira_mod.add_comment("ITHD-36", "   ")
    assert out["ok"] is False
    assert _FakeClient.calls == []


def test_the_update_handler_sends_the_comment_before_the_local_write():
    source = inspect.getsource(tickets_api.ticket_update)
    comment = source.index("add_comment(row.jira_key, req.comment")
    write = source.index("with SessionLocal() as s:")
    assert comment < write


def test_attachment_handler_uploads_to_jira_before_storing():
    source = inspect.getsource(tickets_api.ticket_attachment_add)
    upload = source.index("upload_attachment(row.jira_key")
    store = source.index("TicketAttachment(")
    assert upload < store
    assert "Jira rejected the attachment" in source


def test_assign_issue_resolves_a_username_to_an_account_id(configured):
    import httpx

    _FakeClient.get_payload = [{"accountId": "acc-1", "displayName": "Carol",
                                "emailAddress": "carol@example.com"}]
    _FakeClient.response = _Resp(204, {})
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.assign_issue("ITHD-36", "carol")

    assert out["ok"] is True
    assert out["account_id"] == "acc-1"
    put = _FakeClient.calls[0]
    assert put["put_url"].endswith("/rest/api/3/issue/ITHD-36/assignee")
    assert put["json"] == {"accountId": "acc-1"}


def test_assign_issue_reports_when_nobody_matches(configured):
    import httpx

    _FakeClient.get_payload = []
    configured.setattr(httpx, "Client", _FakeClient)

    out = jira_mod.assign_issue("ITHD-36", "ghost")
    assert out["ok"] is False
    assert "no Jira user" in out["detail"]
