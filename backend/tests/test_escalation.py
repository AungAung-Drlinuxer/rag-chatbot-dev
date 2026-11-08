"""Phase 6 escalation tests — no Jira network needed (mock create / link-only)."""
from app.config import SETTINGS
from app.integrations import jira


def test_escalate_link_only_when_no_base(monkeypatch):
    monkeypatch.setattr(SETTINGS, "jira_base_url", "")
    r = jira.escalate("DB timeout", "desc", reporter="jsmith")
    assert r["mode"] == "link"
    assert r["reporter"] == "jsmith"


def test_escalate_mock_create_as_user(monkeypatch):
    monkeypatch.setattr(SETTINGS, "jira_base_url", "http://jira.example.local")
    monkeypatch.setattr(SETTINGS, "jira_token", "")  # no token → dev mock create
    r = jira.escalate("DB timeout", "desc", reporter="jsmith")
    assert r["mode"] == "rest"
    assert r["jira_key"].startswith("ESC-")
    assert r["reporter"] == "jsmith"          # created BY the authenticated user


def test_escalate_mock_reporter_is_user():
    # reporter must come through (ticket created by the user, not a service account)
    r = jira.escalate("hi", "d", reporter="jsmith")
    assert r["reporter"] == "jsmith"
