"""A misspelt username must not read as "wrong password" — that is how a login loop starts."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.auth import ldap_auth
from app.main import app

client = TestClient(app)


def test_unknown_user_is_named_in_the_error(monkeypatch) -> None:
    monkeypatch.setattr(ldap_auth, "ldap_cfg", lambda: {})  # no directory configured
    r = client.post("/api/auth/login", json={"username": "nobody@example.com", "password": "x"})
    assert r.status_code == 401
    detail = r.json()["detail"]
    assert "No account named" in detail
    assert "nobody@example.com" in detail


def test_wrong_password_stays_generic(monkeypatch) -> None:
    """An account that exists must not be confirmed to an attacker by a different message."""
    monkeypatch.setattr(ldap_auth, "authenticate", lambda u, p: None)
    import app.api.auth as auth_api

    monkeypatch.setattr(auth_api, "authenticate", lambda u, p: None)
    r = client.post("/api/auth/login", json={"username": "someone", "password": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "Invalid credentials"


def test_authenticate_reports_unknown_when_no_directory(monkeypatch) -> None:
    monkeypatch.setattr(ldap_auth, "ldap_cfg", lambda: {})
    assert ldap_auth.authenticate("ghost", "pw") == "unknown:ghost"
