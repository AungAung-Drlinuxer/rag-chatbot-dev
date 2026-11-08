"""Every settings endpoint that reads a `system_settings` row, exercised end-to-end.

Written because a refactor of the repeated JSON-decode idiom silently dropped the
`row = s.execute(...).first()` line in four of these handlers: the code still
compiled, and no existing test touched them, so the only symptom would have been a
NameError in production. Static analysis caught it; this test keeps it caught.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.jwt import create_access_token


@pytest.fixture(scope="module")
def client():
    from app.main import app
    from app.persistence.database import engine, init_db

    init_db()
    with engine.begin() as conn:
        # not a SQLAlchemy model — prod creates it out of band
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS system_settings ("
            " key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())"
        ))
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin():
    from app.config import SETTINGS

    names = [u.strip() for u in (SETTINGS.dev_admin_usernames or "").split(",") if u.strip()]
    assert names, "dev_admin_usernames is empty — no admin identity available in tests"
    return {"Authorization": f"Bearer {create_access_token(names[0])}"}


# --------------------------------------------------------------------------- #
# the four handlers whose fetch line was dropped
# --------------------------------------------------------------------------- #

def test_smtp_get_works_with_no_row(client, admin):
    """Missing row must degrade to {} — not raise NameError."""
    r = client.get("/api/settings/smtp", headers=admin)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict)


def test_smtp_put_then_get(client, admin):
    r = client.put("/api/settings/smtp", headers=admin,
                   json={"smtp": {"host": "smtp.example.com", "port": 587,
                                  "username": "ops@example.com", "from_address": "ops@example.com"}})
    assert r.status_code == 200, r.text

    r = client.get("/api/settings/smtp", headers=admin)
    assert r.status_code == 200, r.text
    # the write-only policy must still hold: no secret echoed back
    body = r.json()
    assert "password" not in body or body.get("password") in (None, "", "********"), body


def test_smtp_put_rejects_a_non_object(client, admin):
    r = client.put("/api/settings/smtp", headers=admin, json={"smtp": "not-an-object"})
    assert r.status_code == 400, r.text


def test_llm_models_endpoint_does_not_crash_without_a_key(client, admin):
    """No stored llm config -> the handler must answer, not 500 on an undefined name."""
    r = client.get("/api/settings/integrations/llm/models", headers=admin)
    assert r.status_code in (200, 400, 502), r.text
    if r.status_code == 200:
        body = r.json()
        assert "models" in body and isinstance(body["models"], list)


def test_integration_test_endpoint_handles_an_unconfigured_key(client, admin):
    """`test_integration` reads the row for the requested key — unset must not 500."""
    r = client.post("/api/settings/integrations/jira/test", headers=admin)
    assert r.status_code in (200, 400, 404), r.text


# --------------------------------------------------------------------------- #
# the endpoints typed in the response_model pass
# --------------------------------------------------------------------------- #

def test_branding_round_trips(client, admin):
    before = client.get("/api/branding")
    assert before.status_code == 200, before.text
    assert {"logo", "appName", "updated_at"} <= set(before.json())

    original = before.json()["appName"]
    try:
        r = client.put("/api/admin/branding/app-name", headers=admin,
                       json={"appName": "Hermes Test"})
        assert r.status_code in (200, 404, 422), r.text
        if r.status_code == 200:
            assert client.get("/api/branding").json()["appName"] == "Hermes Test"
    finally:
        client.put("/api/admin/branding/app-name", headers=admin, json={"appName": original})

    assert client.get("/api/branding").json()["appName"] == original, "restore failed"


def test_runtime_is_readable_and_typed(client, admin):
    r = client.get("/api/runtime", headers=admin)
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), dict) and r.json()


def test_the_removed_connector_endpoint_is_gone(client):
    # MCP was removed from the product; the route must not linger behind auth either.
    assert client.get("/api/mcp/servers").status_code == 404
