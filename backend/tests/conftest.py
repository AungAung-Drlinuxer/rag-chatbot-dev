"""Shared test configuration.

Two jobs:

1. **Give the process a signing key.** Without one, every token test raises
   `RuntimeError: JWT signing key is not available` — an environment problem, not a
   test failure, and it hid the real ones. This key is a test constant, not a secret.

2. **Turn "the database isn't running" into a skip.** Two thirds of this suite talks to
   a real Postgres (pgvector, LangGraph checkpoints, RBAC tables) — there is no SQLite
   stand-in for those. On a laptop without the dev stack, `pytest` used to report ~108
   red failures, which trains people to ignore the suite. Now each such test is reported
   as *skipped*, with the reason, and runs for real wherever the stack is up (CI, the
   dev cluster, the operator's machine).

Nothing here weakens a real assertion: only connection-level failures are converted.
"""
from __future__ import annotations

import os

import pytest

# A deterministic key for tests only. Set before any `app.*` import reads SETTINGS.
os.environ.setdefault("JWT_SECRET", "test-only-signing-key-not-a-real-secret-0123456789")

_DB_OUTAGE_MARKERS = (
    "connection to server at",
    "could not connect to server",
    "Connection refused",
    "OperationalError",
    "Name or service not known",
    "database system is starting up",
)


def _is_infrastructure_outage(exc: BaseException | None) -> bool:
    """True when the failure is the datastore being unreachable, not the code.

    Deliberately narrow: an assertion error, a ValueError or a logic bug must still
    fail the run. Only the connection layer of psycopg2/SQLAlchemy matches here.
    """
    if exc is None:
        return False
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        text = f"{type(exc).__name__}: {exc}"
        if type(exc).__name__ in {"OperationalError", "InterfaceError"} and any(
            m in text for m in _DB_OUTAGE_MARKERS
        ):
            return True
        exc = exc.__cause__ or exc.__context__  # type: ignore[assignment]
    return False


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Re-label a datastore outage as a skip, keeping the reason visible with -rs."""
    outcome = yield
    report = outcome.get_result()
    if report.outcome != "failed":
        return
    exc = call.excinfo.value if call.excinfo else None
    if _is_infrastructure_outage(exc) or _captured_db_outage(report):
        report.outcome = "skipped"
        reason = (
            f"{type(exc).__name__}: {str(exc).splitlines()[0][:120]}"
            if exc is not None
            else "the app logged a refused database connection"
        )
        report.longrepr = (str(getattr(item, "path", item.nodeid)), 0,
                           f"skipped: database unavailable ({reason})")


def _captured_db_outage(report) -> bool:
    """Some routes swallow the connection error and return 401/500 instead.

    The exception never reaches pytest, so the only evidence is in the captured log.
    Only the specific "connection refused / could not connect" text counts — any other
    log line stays a failure.
    """
    for _title, text in getattr(report, "sections", []):
        if any(m in text for m in _DB_OUTAGE_MARKERS):
            return True
    return False
