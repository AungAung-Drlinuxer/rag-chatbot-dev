"""A dead re-classification run must not look alive forever.

Regression: the job was a thread inside the web worker. Deploying the backend killed the
thread at 70/104 and the status row still said "running", so the Knowledge page polled a
percentage that could never reach 100.
"""
from __future__ import annotations

import json
import time

import pytest

from app.knowledge import reclassify


@pytest.fixture()
def db():
    from app.persistence.database import SessionLocal

    try:
        with SessionLocal() as s:
            s.execute(__import__("sqlalchemy").text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"database unavailable: {exc}")
    return SessionLocal


def _write(db, payload: dict) -> None:
    from app.persistence.models import RuntimeKv

    with db() as s:
        row = s.get(RuntimeKv, reclassify._STATUS_KEY)
        if row is None:
            s.add(RuntimeKv(key=reclassify._STATUS_KEY, value=json.dumps(payload)))
        else:
            row.value = json.dumps(payload)
        s.commit()


def test_stale_running_run_is_reported_as_interrupted(db) -> None:
    _write(db, {
        "state": "running", "total": 104, "done": 70, "changed": 4,
        "started_at": time.time() - 4000, "heartbeat_at": time.time() - 4000,
    })
    st = reclassify.reclassify_status()
    assert st["state"] == "interrupted"
    assert "70/104" in st["error"]
    assert st["done"] == 70


def test_live_run_stays_running(db) -> None:
    _write(db, {
        "state": "running", "total": 104, "done": 12,
        "started_at": time.time() - 30, "heartbeat_at": time.time() - 5,
    })
    assert reclassify.reclassify_status()["state"] == "running"


def test_status_writes_carry_a_heartbeat(db) -> None:
    before = time.time()
    reclassify._write_status({"state": "running", "total": 3, "done": 1})
    st = reclassify.reclassify_status()
    assert st["heartbeat_at"] >= before
    assert st["state"] == "running"


def test_a_finished_run_is_left_alone(db) -> None:
    _write(db, {"state": "done", "total": 5, "done": 5, "finished_at": time.time() - 9999,
                "heartbeat_at": time.time() - 9999})
    assert reclassify.reclassify_status()["state"] == "done"
