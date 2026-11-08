"""Handlers that referenced names they never imported, and routes that must stay gone.

`/api/departments` once answered 500 with `NameError: name 'Department' is not defined`
because the module imported the session helper but not the model, and the escalation path
called `jira_route`/`build_context` the same way. Import-time checks cannot see these, so
each handler that still exists gets called once here.

The departments feature itself has since been removed (the directory's `users.department`
column is the only source of a user's department), so the test that used to call its handler
now pins that the routes are absent — a deleted feature that still answers 200 behind an auth
guard looks like a working feature to whoever finds the URL.
"""
from __future__ import annotations


def test_department_routes_are_gone():
    from app.api import users

    paths = {getattr(r, "path", "") for r in users.router.routes}
    assert not any(p.startswith("/api/departments") for p in paths)
    assert not any("department" in p for p in paths)


def test_chat_module_imports_its_helpers():
    # These were undefined at call time, not import time, so assert they resolve now.
    from app.api import chat

    assert callable(chat.build_context)
    assert callable(chat.jira_route)
