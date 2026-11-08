"""Tests for the /api/settings + /api/admin/settings + /api/integrations/status routes (Phase 10.1)."""

from app import runtime
from app.main import app


def _client():
    from fastapi.testclient import TestClient
    return TestClient(app)


def _token(username="dev"):
    """Use the same helper the other tests use (bypasses LDAP when dev fallback is set)."""
    from app.auth.jwt import create_access_token
    return create_access_token(username)


def test_get_settings_creates_row_for_new_user():
    """A GET on /api/settings for a never-seen user must auto-create defaults."""
    runtime.reset("retrieval_top_k")
    client = _client()
    headers = {"Authorization": f"Bearer {_token('freshuser')}"}
    r = client.get("/api/settings", headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["username"] == "freshuser"
    assert data["theme"] == "system"
    assert data["show_token_usage"] is True
    assert data["escalate_include_transcript"] is True


def test_put_settings_merges_known_fields_and_ignores_unknown():
    client = _client()
    headers = {"Authorization": f"Bearer {_token('settingsuser')}"}
    client.get("/api/settings", headers=headers)  # create row
    r = client.put("/api/settings",
                   headers=headers,
                   json={"theme": "dark", "show_token_usage": False, "evil_key": 1})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["theme"] == "dark"
    assert data["show_token_usage"] is False
    assert "evil_key" not in data


def test_admin_settings_list_requires_admin_role():
    """Non-admin users must be rejected with 403."""
    client = _client()
    headers = {"Authorization": f"Bearer {_token('notadmin')}"}
    r = client.get("/api/admin/settings", headers=headers)
    assert r.status_code == 403, r.text


def test_admin_settings_put_persists_runtime_override(monkeypatch):
    """Admin saves a top_k override; the next GET reflects it on the same request."""
    # Force a known dev-admin identity
    from app.config import SETTINGS as S
    assert "dev" in S.dev_admin_usernames
    client = _client()
    headers = {"Authorization": f"Bearer {_token('dev')}"}
    runtime.reset("retrieval_top_k")
    r = client.put("/api/admin/settings", headers=headers,
                   json={"knobs": {"retrieval_top_k": 11}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["applied"]["retrieval_top_k"] == 11
    # Verify the helper sees it
    assert runtime.get("retrieval_top_k") == 11
    runtime.reset("retrieval_top_k")


def test_admin_settings_delete_resets_to_default():
    client = _client()
    headers = {"Authorization": f"Bearer {_token('dev')}"}
    runtime.set_("retrieval_top_k", 13)
    r = client.delete("/api/admin/settings/retrieval_top_k", headers=headers)
    assert r.status_code == 200, r.text
    assert runtime.get("retrieval_top_k") == 5


def test_integrations_status_never_exposes_secrets():
    """The status grid must report only set/missing/placeholder, never raw values."""
    client = _client()
    headers = {"Authorization": f"Bearer {_token('dev')}"}
    r = client.get("/api/integrations/status", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    for section in ("llm", "redis", "jira", "confluence", "ldap"):
        assert section in body, f"missing {section}"
    # The OpenRouter key is real (set), so it must be the meta string, not the key itself
    api_key_meta = body["llm"]["api_key"]
    assert api_key_meta in {"set", "missing", "placeholder"}
    # And it MUST NOT contain the raw key or any password-bearing URL
    assert not any(part in r.text for part in ("sk-or-v1-", "REPLACE_ME_kubeseal", "sk-1wg6q")), \
        f"secret leaked in response: {r.text[:200]}"
    # DB URL must be masked (password replaced with ***)
    assert "app:***@" in body["postgres"]["url"], "postgres URL not masked"
    assert "REPLACE_ME" not in body["postgres"]["url"], "postgres password leaked via URL"
    # The version must be the new one
    assert body["app"]["version"] == "0.2.0"
