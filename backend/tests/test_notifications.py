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


def test_clear_dismisses_items_for_that_user_only(seeded):
    """Clear records the ids server-side; the same rows must not reappear on the next poll."""
    who = "dev"
    before = client.get("/api/notifications", headers=_auth(who)).json()["notifications"]
    assert before, "fixture should give the caller at least one notice"

    r = client.post("/api/notifications/clear", json={"ids": [i["id"] for i in before]}, headers=_auth(who))
    assert r.status_code == 200
    assert r.json()["cleared"] == len(before)

    after = client.get("/api/notifications", headers=_auth(who)).json()["notifications"]
    assert {i["id"] for i in after}.isdisjoint({i["id"] for i in before})

    # A different account still sees its own notice — dismissals are per user.
    other = client.get("/api/notifications", headers=_auth("someone-else")).json()["notifications"]
    assert other, "another user's feed must not be affected"

    with SessionLocal() as s:
        s.execute(text("DELETE FROM notification_dismissals WHERE username = :u"), {"u": who})
        s.commit()


def test_clear_all_without_ids_dismisses_the_visible_feed(seeded):
    who = "dev"
    r = client.post("/api/notifications/clear", json={}, headers=_auth(who))
    assert r.status_code == 200 and r.json()["cleared"] >= 0
    assert client.get("/api/notifications", headers=_auth(who)).json()["notifications"] == []
    with SessionLocal() as s:
        s.execute(text("DELETE FROM notification_dismissals WHERE username = :u"), {"u": who})
        s.commit()


def test_pref_turns_a_category_off(seeded):
    """notifyTickets=false hides the "your escalation was decided" notices, not everything."""
    who = "dev"
    assert client.get("/api/notifications", headers=_auth(who)).json()["prefs"]["notifyTickets"] is True
    client.put("/api/settings", json={"notifyTickets": False}, headers=_auth(who))
    try:
        feed = client.get("/api/notifications", headers=_auth(who)).json()
        assert feed["prefs"]["notifyTickets"] is False
        assert all(i["kind"] != "info" for i in feed["notifications"])
    finally:
        client.put("/api/settings", json={"notifyTickets": True}, headers=_auth(who))
