"""Integration configuration is administrator-only.

GET/PUT/DELETE `/api/settings/integrations/{key}` and the connection test were guarded by
`get_current_user` alone, so any signed-in member could read the (masked) configuration and
overwrite or clear it — including the LLM API key, the Jira API token, the LDAP bind
password and the SMTP credentials. The Settings page hid the panel, but hiding a screen is
not access control: the endpoint answered.

These tests call the real routes through TestClient and change only the caller's role.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.auth.rbac as rbac
from app.auth.deps import get_current_user
from app.main import app

client = TestClient(app)
PATHS = [
    ("get", "/api/settings/integrations/llm"),
    ("put", "/api/settings/integrations/llm"),
    ("post", "/api/settings/integrations/llm/test"),
    ("get", "/api/settings/integrations/llm/models"),
    ("delete", "/api/settings/integrations/llm?confirm=llm"),
    ("get", "/api/integrations/status"),
]


@pytest.fixture(autouse=True)
def _role(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: "someone"
    yield
    app.dependency_overrides.clear()


def _call(method: str, path: str):
    if method == "put":
        return client.put(path, json={"settings": {"base_url": "http://x"}})
    return getattr(client, method)(path)


@pytest.mark.parametrize("method,path", PATHS)
def test_member_is_forbidden(monkeypatch, method, path):
    monkeypatch.setattr(rbac, "get_role", lambda username: "user")
    r = _call(method, path)
    assert r.status_code == 403, f"{method.upper()} {path} answered {r.status_code}"


@pytest.mark.parametrize("role", ["knowledge", "domain_manager"])
def test_other_roles_are_forbidden_too(monkeypatch, role):
    """Support staff and knowledge managers configure articles, not credentials."""
    monkeypatch.setattr(rbac, "get_role", lambda username: role)
    assert client.get("/api/settings/integrations/jira").status_code == 403


def test_admin_passes_the_gate(monkeypatch):
    monkeypatch.setattr(rbac, "get_role", lambda username: "admin")
    r = client.get("/api/settings/integrations/jira")
    # 200 when the DB is reachable; 500 would mean the route itself broke. Never 403.
    assert r.status_code != 403
