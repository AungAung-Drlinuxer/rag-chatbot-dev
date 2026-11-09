"""Escalation API: nothing is created without confirmation, and a retry is not a duplicate."""
from __future__ import annotations

import json
import uuid

import pytest
from fastapi.testclient import TestClient

from app.api import escalations as E
from app.main import app
from app.persistence.database import SessionLocal
from app.persistence.models import ChatMessage, ChatSession

client = TestClient(app)


def _auth() -> dict:
    from app.auth.jwt import create_access_token

    return {"Authorization": f"Bearer {create_access_token('dev')}"}


@pytest.fixture(autouse=True)
def _allow_create():
    app.dependency_overrides[E._require_create] = lambda: "dev"
    yield
    app.dependency_overrides.pop(E._require_create, None)


@pytest.fixture()
def session_with_messages():
    sid = str(uuid.uuid4())
    with SessionLocal() as s:
        s.add(ChatSession(id=sid, username="dev", title="VPN drops"))
        s.flush()  # no relationship() between the models — insert the parent first
        s.add(ChatMessage(session_id=sid, role="user",
                          content="my VPN drops every 10 minutes"))
        s.add(ChatMessage(session_id=sid, role="assistant",
                          content="Restart the client and check the logs.",
                          meta=json.dumps({"hits": [
                              {"title": "VPN runbook", "source_url": "https://kb/vpn"}]})))
        s.add(ChatMessage(session_id=sid, role="user",
                          content="restarted it, still drops, error 619, my key is "
                                  "sk-test-REDACTED-fixture"))
        s.commit()
    yield sid
    with SessionLocal() as s:
        s.query(ChatMessage).filter(ChatMessage.session_id == sid).delete()
        s.query(ChatSession).filter(ChatSession.id == sid).delete()
        s.commit()


def test_draft_requires_auth() -> None:
    r = client.post("/api/escalations/draft", json={"session_id": str(uuid.uuid4())})
    assert r.status_code == 401


def test_draft_of_someone_elses_conversation_is_not_found() -> None:
    sid = str(uuid.uuid4())
    with SessionLocal() as s:
        s.add(ChatSession(id=sid, username="someone-else"))
        s.commit()
    try:
        r = client.post("/api/escalations/draft", json={"session_id": sid}, headers=_auth())
        assert r.status_code == 404
    finally:
        with SessionLocal() as s:
            s.query(ChatSession).filter(ChatSession.id == sid).delete()
            s.commit()


def test_draft_is_structured_and_redacted(session_with_messages, monkeypatch) -> None:
    # Force the deterministic path: no network, no model.
    monkeypatch.setattr("app.llm.client.make_llm", lambda: None)

    r = client.post("/api/escalations/draft",
                    json={"session_id": session_with_messages}, headers=_auth())
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["draft_id"] and body["content_hash"]
    assert body["summary"]
    assert body["description"]
    assert "sk_test" not in json.dumps(body), "a secret must not reach the draft"
    assert body["kb_links"] and body["kb_links"][0]["url"] == "https://kb/vpn"
    assert body["missing_info"], "unknowns are listed, not filled in"
    assert body["business_impact"] == ""

    # A draft is not a ticket.
    assert body.get("jira_key") in (None, "")


def test_submit_validates_before_calling_jira(session_with_messages, monkeypatch) -> None:
    monkeypatch.setattr("app.llm.client.make_llm", lambda: None)
    monkeypatch.setattr(E.jira_fields, "validate", lambda fields: ["Summary is required."])

    draft = client.post("/api/escalations/draft",
                        json={"session_id": session_with_messages}, headers=_auth()).json()
    r = client.post("/api/escalations/submit", headers=_auth(), json={
        "draft_id": draft["draft_id"], "base_hash": draft["content_hash"],
        "summary": "", "description": "x", "project": "IT", "issue_type": "Task",
        "priority": "", "custom_fields": {}, "idempotency_key": str(uuid.uuid4()),
    })
    assert r.status_code == 422
    assert "Summary is required." in r.text


def test_submit_creates_once_and_repeats_are_idempotent(session_with_messages, monkeypatch) -> None:
    monkeypatch.setattr("app.llm.client.make_llm", lambda: None)
    monkeypatch.setattr(E.jira_fields, "validate", lambda fields: [])

    calls = {"n": 0}

    def fake_create(**kwargs):
        calls["n"] += 1
        return {"jira_key": "IT-4242", "link": "https://jira/browse/IT-4242", "mode": "rest"}

    monkeypatch.setattr("app.integrations.jira.create_issue", fake_create)

    draft = client.post("/api/escalations/draft",
                        json={"session_id": session_with_messages}, headers=_auth()).json()
    payload = {
        "draft_id": draft["draft_id"], "base_hash": draft["content_hash"],
        "summary": draft["summary"], "description": draft["description"] + "\n\nEdited by user",
        "project": "IT", "issue_type": "Task", "priority": "Medium",
        "custom_fields": {}, "idempotency_key": str(uuid.uuid4()),
    }

    first = client.post("/api/escalations/submit", headers=_auth(), json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["jira_key"] == "IT-4242"
    assert first.json()["duplicate"] is False

    # The same click again (double submit) must not open a second ticket.
    second = client.post("/api/escalations/submit", headers=_auth(), json=payload)
    assert second.status_code == 200
    assert second.json()["jira_key"] == "IT-4242"
    assert second.json()["duplicate"] is True
    assert calls["n"] == 1

    # The user's edit is what got submitted, not the generated text.
    with SessionLocal() as s:
        row = s.get(E.EscalationDraft, draft["draft_id"])
        assert row.status == "submitted"
        assert "Edited by user" in row.payload["description"]
        assert row.approved_hash and row.approved_hash != draft["content_hash"]


def test_submit_reports_jira_failure_and_keeps_the_draft(session_with_messages, monkeypatch) -> None:
    monkeypatch.setattr("app.llm.client.make_llm", lambda: None)
    monkeypatch.setattr(E.jira_fields, "validate", lambda fields: [])
    monkeypatch.setattr("app.integrations.jira.create_issue",
                        lambda **kw: {"jira_key": None, "error": "boom"})

    draft = client.post("/api/escalations/draft",
                        json={"session_id": session_with_messages}, headers=_auth()).json()
    r = client.post("/api/escalations/submit", headers=_auth(), json={
        "draft_id": draft["draft_id"], "base_hash": draft["content_hash"],
        "summary": "VPN", "description": "drops", "project": "IT", "issue_type": "Task",
        "priority": "", "custom_fields": {}, "idempotency_key": str(uuid.uuid4()),
    })
    assert r.status_code == 502

    again = client.get(f"/api/escalations/drafts/{draft['draft_id']}", headers=_auth())
    assert again.status_code == 200
    assert again.json()["status"] == "failed"
    assert again.json()["description"]
