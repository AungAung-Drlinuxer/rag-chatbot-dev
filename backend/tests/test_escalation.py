"""Phase 6 escalation tests — no Jira network needed (mock create / link-only)."""
import pytest

from app.config import SETTINGS
from app.integrations import jira


@pytest.fixture(autouse=True)
def _fresh_jira_config():
    """`_jira_cfg()` caches for a few seconds, so one test's monkeypatched base_url leaked
    into the next. Reset it around every test instead of weakening the assertions."""
    jira._JIRA_CFG_CACHE = None
    yield
    jira._JIRA_CFG_CACHE = None


def test_escalate_link_only_when_no_base(monkeypatch):
    monkeypatch.setattr(SETTINGS, "jira_base_url", "")
    r = jira.escalate("DB timeout", "desc", reporter="jsmith")
    assert r["mode"] == "link"
    assert r["reporter"] == "jsmith"


def test_escalate_without_credentials_links_instead_of_inventing_a_key(monkeypatch):
    """v1.6.4 — the mock "ESC-1234" keys were removed on purpose: a ticket that does not
    exist in Jira is worse than no ticket. Without credentials the caller gets the
    create link plus an explicit error, never a fabricated key."""
    monkeypatch.setattr(SETTINGS, "jira_base_url", "http://jira.example.local")
    monkeypatch.setattr(SETTINGS, "jira_token", "")
    monkeypatch.setattr(SETTINGS, "jira_email", "")
    r = jira.escalate("DB timeout", "desc", reporter="jsmith")
    assert r["mode"] == "link"
    assert r["jira_key"] is None
    assert "credentials missing" in r["error"].lower()
    assert r["reporter"] == "jsmith"          # attributed to the authenticated user


def test_escalate_mock_reporter_is_user():
    # reporter must come through (ticket created by the user, not a service account)
    r = jira.escalate("hi", "d", reporter="jsmith")
    assert r["reporter"] == "jsmith"
