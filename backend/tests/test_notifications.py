"""The bell's feed: user-scoped, derived from real rows, and honest about "nothing"."""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.persistence.database import SessionLocal

client = TestClient(app)


def _auth(who: str = "dev") -> dict:
    from app.auth.jwt import create_access_token

    return {"Authorization": f"Bearer {create_access_token(who)}"}


@pytest.fixture()
def seeded():
    """One pending approval, one decided approval for 'dev', one for someone else."""
    ids = {"pending": str(uuid.uuid4()), "decided": str(uuid.uuid4()), "other": str(uuid.uuid4())}
    with SessionLocal() as s:
        for key, (who, status) in {
            "pending": ("dev", "pending"),
            "decided": ("dev", "rejected"),
            "other": ("someone-else", "rejected"),
        }.items():
            s.execute(text(
                "INSERT INTO approvals (id, username, question, status) "
                "VALUES (:i, :u, :q, :st)"
            ), {"i": ids[key], "u": who, "q": f"probe {key}", "st": status})
        s.commit()
    yield ids
    with SessionLocal() as s:
        s.execute(text("DELETE FROM approvals WHERE id = ANY(CAST(:i AS uuid[]))"),
                  {"i": list(ids.values())})
        s.commit()


def test_requires_auth() -> None:
    assert client.get("/api/notifications").status_code == 401


def test_feed_is_shaped_for_the_bell(seeded) -> None:
    r = client.get("/api/notifications", headers=_auth())
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["notifications"], list)
    assert body["generated_at"]
    for item in body["notifications"]:
        assert set(item) == {"id", "kind", "label", "sub", "nav", "created_at"}
        assert item["kind"] in ("approval", "ldap", "monitoring", "info")


def test_my_decided_escalation_is_reported_and_someone_elses_is_not(seeded) -> None:
    items = client.get("/api/notifications", headers=_auth("dev")).json()["notifications"]
    labels = [i["id"] for i in items]
    assert f"apd-{seeded['decided']}" in labels
    assert f"apd-{seeded['other']}" not in labels, "another user's decision must not leak"
    decided = next(i for i in items if i["id"] == f"apd-{seeded['decided']}")
    assert "not approved" in decided["label"]


def test_pending_approvals_are_visible_when_the_role_manages_them(seeded, monkeypatch) -> None:
    from app.api import notifications as mod

    monkeypatch.setattr(mod, "get_role", lambda _u: "admin")
    admin_items = client.get("/api/notifications", headers=_auth("dev")).json()["notifications"]
    assert f"ap-{seeded['pending']}" in [i["id"] for i in admin_items]

    monkeypatch.setattr(mod, "get_role", lambda _u: "user")
    user_items = client.get("/api/notifications", headers=_auth("dev")).json()["notifications"]
    assert f"ap-{seeded['pending']}" not in [i["id"] for i in user_items], (
        "a plain user has no approval queue to work")
