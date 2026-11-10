"""The response models must not change a single byte of the wire contract.

FastAPI serializes the handler's dict THROUGH `response_model`, so a model that
misses a field silently deletes it from the payload. These tests pin the exact
key sets that the SPA reads, so that failure mode can never ship unnoticed.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import create_access_token


@pytest.fixture(scope="module")
def client():
    from sqlalchemy import text

    from app.main import app
    from app.persistence.database import engine, init_db

    init_db()
    # `system_settings` is not a SQLAlchemy model — prod creates it out of band, so
    # `init_db()` alone leaves it missing and the branding/llm endpoints 500 in a
    # fresh database. Create the minimal shape they read.
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS system_settings ("
            "  key TEXT PRIMARY KEY,"
            "  value JSONB,"
            "  updated_at TIMESTAMPTZ DEFAULT NOW()"
            ")"
        ))
    with TestClient(app) as c:
        yield c


def _token(username: str = "dev") -> str:
    return create_access_token(username)


def _h(username: str = "dev") -> dict:
    return {"Authorization": f"Bearer {_token(username)}"}


def _schema(client, path: str, method: str = "get") -> dict:
    """Read the schema from the app object, not from GET /openapi.json.

    The HTTP endpoint only exists when docs are enabled for that deployment, so the test
    used to fail on `spec["paths"]` for a reason that had nothing to do with response
    models. `app.openapi()` is always available and is the same document.
    """
    from app.main import app

    spec = app.openapi()
    return spec["paths"][path][method]["responses"]["200"]["content"]["application/json"]["schema"]


# --------------------------------------------------------------------------- #
# the models are declared
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "path,method",
    [
        ("/health", "get"),
        ("/api/branding", "get"),
        ("/api/escalations", "get"),
        ("/api/feedback", "post"),
        ("/api/eval", "get"),
    ],
)
def test_route_declares_a_named_response_model(client, path, method):
    schema = _schema(client, path, method)
    ref = schema.get("$ref", "")
    assert ref.startswith("#/components/schemas/"), (
        f"{method.upper()} {path} has no response_model — schema was {schema}"
    )


# --------------------------------------------------------------------------- #
# the payload keeps every key the SPA reads
# --------------------------------------------------------------------------- #

def test_health_keeps_its_keys(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert {"status", "env", "conf_threshold"} <= set(body)
    assert body["status"] == "ok"


def test_branding_keeps_its_keys(client):
    r = client.get("/api/branding")          # PUBLIC — no token
    assert r.status_code == 200
    assert {"logo", "appName", "updated_at"} <= set(r.json())


def test_escalations_keeps_its_keys(client):
    r = client.get("/api/escalations", headers=_h())
    assert r.status_code == 200, r.text
    assert "escalations" in r.json()
    assert isinstance(r.json()["escalations"], list)


def test_feedback_keeps_its_keys(client):
    r = client.post("/api/feedback", headers=_h(),
                    json={"message_id": "m1", "rating": 1, "comment": None})
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"status", "saved", "rating"} <= set(body)
    assert body["status"] == "ok"


def test_eval_cases_keeps_its_keys(client):
    r = client.get("/api/eval", headers=_h())
    assert r.status_code == 200, r.text
    body = r.json()
    assert {"n_cases", "cases"} <= set(body)
    assert body["n_cases"] == len(body["cases"])
    if body["cases"]:
        assert {"question", "domain", "must_contain", "expected_sources"} <= set(body["cases"][0])


# --------------------------------------------------------------------------- #
# extra="allow" is what makes this safe — prove it, do not assume it
# --------------------------------------------------------------------------- #

def test_unknown_fields_are_not_dropped():
    from app.schemas import HealthResponse

    h = HealthResponse(status="ok", env="prod", conf_threshold=0.75, added_later="x")
    assert h.model_dump()["added_later"] == "x"

