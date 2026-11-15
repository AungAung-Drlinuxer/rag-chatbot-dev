"""Phase 6 — list escalations endpoint (GET /api/escalations)."""
import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import create_access_token
from app.main import app

client = TestClient(app)


def _token() -> str:
    """A signed token — the dev password bypass no longer exists (see test_auth.py)."""
    return create_access_token("dev")


def test_list_escalations_shape():
    r = client.get("/api/escalations", headers={"Authorization": f"Bearer {_token()}"})
    if r.status_code == 503:
        pytest.skip("database unavailable — the endpoint reports 503 by design")
    assert r.status_code == 200
    body = r.json()
    assert "escalations" in body
    assert isinstance(body["escalations"], list)


def test_list_escalations_requires_auth():
    assert client.get("/api/escalations").status_code in (401, 403)
