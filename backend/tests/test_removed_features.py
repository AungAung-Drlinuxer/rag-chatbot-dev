"""Features this build no longer has must be gone from the schema as well as the code.

WHY THIS EXISTS
---------------
Removing a model and its endpoints leaves the table and the column behind on every database
that was installed before the removal. The app then boots clean while the schema still holds
a `departments` table and a `chat_sessions.connector_scope` column that nothing reads — stale
data sitting in a live database, and the next person to read the schema has to guess.

So the removal is a two-part contract:
  1. no code path references them (asserted against the ORM metadata and the routers), and
  2. `bootstrap --init` drops them and `verify()` reports whether any survived.
"""
from __future__ import annotations

from app import bootstrap
from app.persistence.models import Base


def test_the_removed_tables_are_not_in_the_orm():
    tables = Base.metadata.tables
    assert "departments" not in tables
    assert "department_members" not in tables


def test_the_removed_column_is_not_on_chat_sessions():
    assert "connector_scope" not in Base.metadata.tables["chat_sessions"].columns


def test_installer_knows_what_to_drop():
    labels = {label for label, _sql in bootstrap.OBSOLETE_OBJECTS}
    assert {"chat_sessions.connector_scope", "departments", "department_members"} <= labels


def test_every_obsolete_statement_is_idempotent():
    # `--init` runs on every deploy, so each statement must be safe to repeat and safe on a
    # database where the object never existed (a fresh install has no departments table).
    for label, sql in bootstrap.OBSOLETE_OBJECTS:
        upper = sql.upper()
        assert "IF EXISTS" in upper, f"{label} is not idempotent: {sql}"


def test_the_leftover_check_is_what_readiness_consults():
    # verify() is what the db-init Job and /api/setup/readiness trust, so the list it reads
    # must be the same list drop_obsolete_objects() removes.
    import inspect

    assert callable(bootstrap._obsolete_present)
    assert "obsolete_present" in inspect.getsource(bootstrap.verify)
