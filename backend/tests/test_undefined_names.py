"""Handlers that referenced names they never imported.

`/api/departments` answered 500 with `NameError: name 'Department' is not defined` because the
module imported the session helper but not the model, and the escalation path called
`jira_route`/`build_context` the same way. Import-time checks cannot see these, so each fixed
handler gets called once here.
"""
from __future__ import annotations

import app.persistence.database as db


class _Query:
    def order_by(self, *a): return self
    def all(self): return []


class _Session:
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def query(self, *a): return _Query()


def test_departments_handler_resolves_its_models(monkeypatch):
    from app.api import users

    # users.py binds SessionLocal at import time, so patch the module's own name — patching
    # the source module only works when users.py has not been imported yet.
    monkeypatch.setattr(users, "SessionLocal", lambda: _Session())
    list_departments = users.list_departments

    assert list_departments(user="diag") == {"departments": []}


def test_chat_module_imports_its_helpers():
    # These were undefined at call time, not import time, so assert they resolve now.
    from app.api import chat

    assert callable(chat.build_context)
    assert callable(chat.jira_route)
