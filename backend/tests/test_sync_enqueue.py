"""The Knowledge page must never hang on a sync.

Regression: POST /api/articles/sync ran the whole ingest inline (~90s). The proxy in front
of the app gave up first, the browser got a 504 and the page said "Sync failed" — while the
sync was still running, and every retry started another one.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _admin(monkeypatch):
    """Bypass auth for this route: the dependencies are bound at decoration time, so they
    have to be overridden rather than monkeypatched."""
    from app.api import knowledge as kmod
    from app.main import app

    route = next(r for r in kmod.router.routes if r.path == "/api/articles/sync")
    for dep in route.dependant.dependencies:
        app.dependency_overrides[dep.call] = lambda: "dev"
    return {}


@pytest.fixture(autouse=True)
def _cleanup(monkeypatch):
    from app.api import knowledge as mod

    monkeypatch.setattr(mod, "audit", lambda *a, **k: None)
    yield
    from app.main import app

    app.dependency_overrides.clear()


def test_sync_is_queued_rather_than_run_inline(monkeypatch) -> None:
    headers = _admin(monkeypatch)
    from app.knowledge import ingest
    from workers import sync_tasks

    monkeypatch.setattr(ingest, "sync_state", lambda: {"state": "idle"})
    queued: list = []

    def fake_delay(*a, **k):
        queued.append(a)
        return SimpleNamespace(id="task-123")

    monkeypatch.setattr(sync_tasks.sync_kb, "delay", fake_delay)

    r = client.post("/api/articles/sync", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] is True
    assert body["task_id"] == "task-123"
    assert queued and queued[0] == ("dev",), "the requester must travel with the task"


def test_a_running_sync_is_refused(monkeypatch) -> None:
    headers = _admin(monkeypatch)
    from app.knowledge import ingest

    monkeypatch.setattr(ingest, "sync_state", lambda: {"state": "running", "by": "scheduler"})
    r = client.post("/api/articles/sync", headers=headers)
    assert r.status_code == 409
    assert "already running" in r.json()["detail"]


def test_two_concurrent_runs_are_serialised(monkeypatch) -> None:
    from app.knowledge import ingest

    monkeypatch.setattr(ingest, "load_all", lambda: [])
    monkeypatch.setattr(ingest, "_write_sync_state", lambda payload: None)
    monkeypatch.setattr(ingest, "register_domains", lambda domains: 0)

    ingest._SYNC_LOCK.acquire()  # simulate a scheduled run in flight
    try:
        with pytest.raises(ingest.SyncBusy):
            ingest.sync_all(updated_by="dev")
    finally:
        ingest._SYNC_LOCK.release()
