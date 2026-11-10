"""A plain `user` sees their own Overview, never the organization's.

The dashboard endpoints were authenticated but not scoped: any signed-in user could read
the week's question count, escalation count, active-user count and — worse — the last ten
questions with the usernames of the colleagues who asked them. The page belongs to every
role, so no route-level gate could have caught it; the queries themselves have to filter.

`_scoped` decides from the role; these tests pin the SQL that decision produces by running
the endpoints against a fake session that records queries.
"""
from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.api import dashboard as dash


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None


class _Session:
    """Returns one numeric row per query and records (sql, params)."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, sql, params=None):
        self.calls.append((str(sql), dict(params or {})))
        return _Result([{"n": 0, "created_at": "", "username": "", "content": "", "meta": "{}"}])

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture()
def fake_db(monkeypatch):
    """Patch `_rows` so each endpoint records the SQL it would have run."""
    calls: list[tuple[str, dict]] = []

    def _rows(sql, params=None):
        calls.append((sql, dict(params or {})))
        return [{"n": 0, "created_at": datetime.now(UTC), "username": "someone",
                 "content": "question", "meta": "{}"}]

    monkeypatch.setattr(dash, "_rows", _rows)
    return calls


def _user(monkeypatch, role):
    monkeypatch.setattr(dash, "_scoped", lambda username: role != "user")


def test_plain_user_stats_are_scoped_to_themselves(fake_db, monkeypatch):
    _user(monkeypatch, "user")
    dash.dashboard_stats(user="alice")
    sql = " ".join(c[0] for c in fake_db)
    params = [c[1] for c in fake_db]
    assert "s.username = :user" in sql, "question counts must be filtered by owner"
    assert "created_by = :user" in sql, "escalations must be filtered by creator"
    assert "AND username = :user" in sql, "guardrail counts must be filtered by owner"
    # Every statement that filters by owner must actually bind the caller; the KB size
    # query has no owner, so it carries no :user placeholder.
    for sql, params in fake_db:
        if ":user" in sql:
            assert params.get("user") == "alice", sql


def test_admin_stats_are_not_scoped(fake_db, monkeypatch):
    _user(monkeypatch, "admin")
    dash.dashboard_stats(user="root")
    sql = " ".join(c[0] for c in fake_db)
    assert "s.username = :user" not in sql
    assert "created_by = :user" not in sql
    assert all("user" not in p for p in [c[1] for c in fake_db])


def test_plain_user_recent_conversations_only_returns_their_own(fake_db, monkeypatch):
    _user(monkeypatch, "user")
    dash.dashboard_recent_conversations(limit=10, user="alice")
    sql, params = fake_db[-1]
    assert "s.username = :user" in sql
    assert params.get("user") == "alice"


def test_knowledge_manager_sees_the_organization(fake_db, monkeypatch):
    """The Knowledge Manager owns org-wide content, so they keep the org view; the
    plain user is the only role that is narrowed."""
    _user(monkeypatch, "knowledge")
    dash.dashboard_recent_conversations(limit=5, user="bob")
    sql, params = fake_db[-1]
    assert "s.username = :user" not in sql
    assert "user" not in params
