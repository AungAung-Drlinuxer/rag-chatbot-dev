"""Prepare a brand-new installation: database, role, extensions, schema, tables.

WHY THIS EXISTS
---------------
Pointing the app at an empty database already works (`init_db()` runs on startup), but a new
operator then has no way in: there is no default account, by design, and the first
administrator has to exist before the UI can be used. This module is that one step, and it
is deliberately the only thing that writes a row an operator did not create in the UI.

It never seeds content: no demo users, no sample articles, no placeholder domains, no
pre-filled settings. A fresh install is an empty workspace with one administrator.

WHAT `--init` DOES (in order, every step idempotent)
----------------------------------------------------
1. creates the login role and the database if `BOOTSTRAP_SUPERUSER_URL` is supplied
2. installs the `vector` extension
3. creates every table the application uses (ORM models + hand-written core tables)
4. hands ownership of every table and sequence to the application role
5. creates LangGraph's checkpoint tables, so approvals survive a pod restart from day one
6. verifies the result and reports what is still missing

USAGE
-----
    # full install against an empty Postgres server
    BOOTSTRAP_SUPERUSER_URL=postgresql://postgres:***@host:5432/postgres \
    BOOTSTRAP_APP_PASSWORD=*** \
    DATABASE_URL=postgresql://app:***@host:5432/assistant \
    python -m app.bootstrap --init

    # what is in this database? (tables, users, admins — no values from settings)
    DATABASE_URL=... python -m app.bootstrap --check

    # make (or promote) the first administrator; the password is read from a prompt,
    # BOOTSTRAP_ADMIN_PASSWORD, or stdin — never from argv, so it stays out of `ps`
    DATABASE_URL=... python -m app.bootstrap --admin jane.doe

The password is stored the same way the UI stores it: salted SHA-256 in
`local_user_credentials`. Directory-backed users need no password here at all — set
`DEV_ADMIN_USERNAMES` for the directory account instead.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import hmac
import json
import os
import secrets
import sys

from sqlalchemy import text

MIN_PASSWORD = 12

# Tables created by hand (they predate the ORM, or they are key/value shapes). Kept in sync
# with `app.persistence.database.init_db` by hand — `verify()` compares the two and reports
# any drift, because a table missing from one list only surfaces at first use in production.
CORE_TABLES = [
    "system_settings",
    "approvals",
    "chat_attachments",
    "semantica_entities",
    "semantica_relations",
]

# Created on first use rather than at install: the vector store by LangChain's PGVector,
# the checkpoint tables by LangGraph (this module creates those in step 5).
LAZY_TABLES = [
    "langchain_pg_collection",
    "langchain_pg_embedding",
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
    "checkpoint_migrations",
]


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    return f"{salt}${digest}"


def _install_extension_as_superuser() -> bool:
    """Create pgvector using BOOTSTRAP_SUPERUSER_URL, if the operator supplied one.

    `CREATE EXTENSION` is the one thing the application role cannot do on a database where
    pgvector has never been installed. Supplying a privileged URL for this single step means
    a fresh install is still one command, and the app keeps running as a non-superuser.
    """
    url = os.environ.get("BOOTSTRAP_SUPERUSER_URL", "").strip()
    if not url:
        return False
    from sqlalchemy import create_engine

    engine = create_engine(url, future=True)
    try:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        return True
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"could not install pgvector with BOOTSTRAP_SUPERUSER_URL: {exc}") from exc
    finally:
        engine.dispose()


def ensure_schema() -> None:
    """Create the pgvector extension and every table (idempotent)."""
    from app.persistence.database import init_db

    try:
        init_db()
    except RuntimeError as exc:
        if _install_extension_as_superuser():
            init_db()
            return
        raise SystemExit(str(exc)) from exc


# --------------------------------------------------------------------------------------
# --init: role, database, ownership, verification
# --------------------------------------------------------------------------------------

def _target() -> tuple[str, str, str, str]:
    """(dbname, role, password, host) parsed from DATABASE_URL. Never printed."""
    from sqlalchemy.engine import make_url

    from app.config import SETTINGS

    url = make_url(SETTINGS.database_url)
    dbname = url.database or "assistant"
    role = url.username or "app"
    password = os.environ.get("BOOTSTRAP_APP_PASSWORD") or url.password or ""
    host = f"{url.host or 'localhost'}:{url.port or 5432}"
    return dbname, role, password, host


def _literal(value: str) -> str:
    """Quote a string literal for a DDL statement (never a value from a user row)."""
    return "'" + value.replace("'", "''") + "'"


def provision_role_and_database() -> dict:
    """CREATE ROLE / CREATE DATABASE when they do not exist. Never alters an existing role.

    An existing role keeps its password on purpose: this runs from CI, cron and install
    jobs, and silently resetting a live password would lock every running pod out.
    """
    admin_url = os.environ.get("BOOTSTRAP_SUPERUSER_URL", "").strip()
    dbname, role, password, host = _target()
    if not admin_url:
        return {"skipped": "BOOTSTRAP_SUPERUSER_URL not set — assuming role and database exist"}

    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    # Connect to the maintenance database: CREATE DATABASE cannot run inside the database
    # it creates.
    engine = create_engine(
        make_url(admin_url).set(database="postgres"), future=True, isolation_level="AUTOCOMMIT"
    )
    created: dict = {"role_created": False, "database_created": False, "host": host}
    try:
        with engine.connect() as conn:
            if not conn.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": role}).first():
                if not password:
                    raise SystemExit(
                        "the application role does not exist and no password was supplied: set "
                        "BOOTSTRAP_APP_PASSWORD (or put the password in DATABASE_URL)"
                    )
                conn.execute(text(f'CREATE ROLE "{role}" LOGIN PASSWORD {_literal(password)}'))
                created["role_created"] = True
            if not conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :d"), {"d": dbname}
            ).first():
                conn.execute(text(f'CREATE DATABASE "{dbname}" OWNER "{role}"'))
                created["database_created"] = True
            conn.execute(text(f'GRANT ALL PRIVILEGES ON DATABASE "{dbname}" TO "{role}"'))
    finally:
        engine.dispose()

    # On Postgres 15+ the public schema is separate from the database privileges: a new
    # database's schema belongs to pg_database_owner, which the app role may not be part of.
    app_engine = create_engine(
        make_url(admin_url).set(database=dbname), future=True, isolation_level="AUTOCOMMIT"
    )
    try:
        with app_engine.connect() as conn:
            conn.execute(text(f'GRANT ALL ON SCHEMA public TO "{role}"'))
    except Exception as exc:  # noqa: BLE001
        print(f"note: could not grant schema rights ({type(exc).__name__}): {exc}", file=sys.stderr)
    finally:
        app_engine.dispose()
    return created


def _expected_tables() -> list[str]:
    from app.persistence.models import Base

    return sorted(set(Base.metadata.tables) | set(CORE_TABLES))


# Objects created by features this build no longer has. A fresh install never creates them,
# but an install that was upgraded still carries the table/column — and a column nobody reads
# is still a column that can hold stale data and confuse the next person reading the schema.
# Removing them here (not in `init_db`) keeps the destructive step behind an explicit `--init`.
OBSOLETE_OBJECTS: list[tuple[str, str]] = [
    ("chat_sessions.connector_scope",
     "ALTER TABLE IF EXISTS chat_sessions DROP COLUMN IF EXISTS connector_scope"),
    ("department_members", "DROP TABLE IF EXISTS department_members"),
    ("departments", "DROP TABLE IF EXISTS departments"),
]


def drop_obsolete_objects() -> dict:
    """Drop schema left by removed features. Idempotent; returns what is still present."""
    from app.persistence.database import SessionLocal

    dropped: list[str] = []
    failed: dict[str, str] = {}
    with SessionLocal() as s:
        for label, statement in OBSOLETE_OBJECTS:
            try:
                s.execute(text(statement))
                s.commit()
                dropped.append(label)
            except Exception as exc:  # noqa: BLE001
                s.rollback()
                failed[label] = f"{type(exc).__name__}: {exc}"
    return {"dropped": dropped, "failed": failed, "still_present": _obsolete_present()}


def _obsolete_present() -> list[str]:
    from app.persistence.database import SessionLocal

    present: list[str] = []
    with SessionLocal() as s:
        column = s.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name='chat_sessions' "
            "AND column_name='connector_scope'"
        )).scalar()
        if column:
            present.append("chat_sessions.connector_scope")
        for table in ("departments", "department_members"):
            exists = s.execute(text(
                "SELECT to_regclass(:t)"), {"t": f"public.{table}"}).scalar()
            if exists:
                present.append(table)
    return present


def ensure_checkpoint_tables() -> bool:
    """Create LangGraph's checkpoint tables. Returns False when langgraph is unavailable."""
    try:
        import psycopg
        from langgraph.checkpoint.postgres import PostgresSaver
    except Exception:  # noqa: BLE001
        return False
    from app.config import SETTINGS

    url = SETTINGS.database_url
    for scheme in ("postgresql+psycopg2://", "postgresql+psycopg://"):
        url = url.replace(scheme, "postgresql://")
    try:
        with psycopg.connect(url, autocommit=True, connect_timeout=10) as conn:
            PostgresSaver(conn).setup()  # type: ignore[arg-type]
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"note: checkpoint tables not created ({type(exc).__name__}: {exc})", file=sys.stderr)
        return False


def ensure_ownership() -> dict:
    """Hand every public table/sequence to the application role.

    A database restored with `pg_dump -O` is owned by whoever ran the restore. The app then
    boots fine and fails at the first ALTER or index build it does not own. Fixing ownership
    at install time makes that failure impossible.
    """
    admin_url = os.environ.get("BOOTSTRAP_SUPERUSER_URL", "").strip()
    if not admin_url:
        return {"skipped": "BOOTSTRAP_SUPERUSER_URL not set"}
    dbname, role, _password, _host = _target()
    from sqlalchemy import create_engine
    from sqlalchemy.engine import make_url

    engine = create_engine(
        make_url(admin_url).set(database=dbname), future=True, isolation_level="AUTOCOMMIT"
    )
    changed = {"tables": 0, "sequences": 0}
    try:
        with engine.connect() as conn:
            for name in [r[0] for r in conn.execute(text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))]:
                owner = conn.execute(text(
                    "SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename=:t"
                ), {"t": name}).scalar()
                if owner != role:
                    conn.execute(text(f'ALTER TABLE public."{name}" OWNER TO "{role}"'))
                    changed["tables"] += 1
            for name in [r[0] for r in conn.execute(text(
                    "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'"))]:
                owner = conn.execute(text(
                    "SELECT sequenceowner::regrole::text FROM pg_sequences "
                    "WHERE schemaname='public' AND sequencename=:s"
                ), {"s": name}).scalar()
                if owner and owner.strip('"') != role:
                    conn.execute(text(f'ALTER SEQUENCE public."{name}" OWNER TO "{role}"'))
                    changed["sequences"] += 1
    finally:
        engine.dispose()
    return changed


def verify() -> dict:
    """Facts an operator can act on: what exists, what is missing, who owns it."""
    from app.persistence.database import SessionLocal

    expected = _expected_tables()
    dbname, role, _password, _host = _target()
    report: dict = {
        "database": dbname,
        "role": role,
        "tables_expected": len(expected),
        "tables_present": 0,
        "missing_tables": [],
    }
    with SessionLocal() as s:
        present = [r[0] for r in s.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"))]
        report["tables_present"] = len(present)
        report["missing_tables"] = sorted(set(expected) - set(present))
        report["lazy_tables_missing"] = sorted(set(LAZY_TABLES) - set(present))
        report["vector_version"] = s.execute(text(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'")).scalar()
        report["table_owners"] = {
            r[0]: int(r[1]) for r in s.execute(text(
                "SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' "
                "GROUP BY tableowner ORDER BY 2 DESC"))
        }
        report["admins"] = int(s.execute(text(
            "SELECT count(*) FROM users WHERE role_override = 'admin'")).scalar() or 0)
    report["obsolete_present"] = _obsolete_present()
    report["owned_by_app"] = report["table_owners"].get(role, 0) == report["tables_present"]
    report["ready"] = (
        not report["missing_tables"]
        and report["vector_version"] is not None
        and report["owned_by_app"]
        and not report["obsolete_present"]
    )
    return report


def create_admin(username: str, password: str) -> None:
    """Insert or promote `username` and set its local password."""
    if len(password) < MIN_PASSWORD:
        raise SystemExit(
            f"password must be at least {MIN_PASSWORD} characters "
            "(it is the only credential protecting an administrator account)"
        )
    if password.lower() == (username or "").lower():
        raise SystemExit("password must not be the username")

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        s.execute(
            text(
                "INSERT INTO users (username, role_override, status) "
                "VALUES (:u, 'admin', 'Active') "
                "ON CONFLICT (username) DO UPDATE SET role_override = 'admin', "
                "status = 'Active', disabled_at = NULL"
            ),
            {"u": username},
        )
        s.execute(
            text(
                "INSERT INTO local_user_credentials (username, password_hash, source) "
                "VALUES (:u, :p, 'local') "
                "ON CONFLICT (username) DO UPDATE SET password_hash = :p, updated_at = NOW()"
            ),
            {"u": username, "p": _hash_password(password)},
        )
        s.commit()


def summary() -> dict:
    """Counts only: enough to answer "is this database ready?", no secret values."""
    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        tables = s.execute(
            text("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")
        ).scalar()
        users = s.execute(text("SELECT count(*) FROM users")).scalar()
        admins = s.execute(
            text("SELECT count(*) FROM users WHERE role_override = 'admin'")
        ).scalar()
        creds = s.execute(text("SELECT count(*) FROM local_user_credentials")).scalar()
        settings = s.execute(text("SELECT count(*) FROM system_settings")).scalar()
        articles = s.execute(text("SELECT count(*) FROM kb_meta")).scalar()
        tickets = s.execute(text("SELECT count(*) FROM jira_tickets")).scalar()
    return {
        "tables": int(tables or 0),
        "users": int(users or 0),
        "admins": int(admins or 0),
        "local_credentials": int(creds or 0),
        "settings_rows": int(settings or 0),
        "kb_articles": int(articles or 0),
        "tickets": int(tickets or 0),
    }


def _read_password() -> str:
    from_env = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
    if from_env:
        return from_env
    if sys.stdin.isatty():
        first = getpass.getpass("Password for the administrator: ")
        again = getpass.getpass("Repeat the password: ")
        if first != again:
            raise SystemExit("passwords did not match")
        return first
    # piped stdin: `printf %s "$PW" | python -m app.bootstrap --admin name`
    return sys.stdin.readline().rstrip("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare a fresh database for this app.")
    parser.add_argument("--init", action="store_true",
                        help="create role, database, extensions, schema, ownership; then verify")
    parser.add_argument("--check", action="store_true",
                        help="create the schema if missing, then report counts")
    parser.add_argument("--admin", metavar="USERNAME",
                        help="create or promote this administrator")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    if not (args.init or args.check or args.admin):
        parser.print_help()
        return 2

    steps: dict = {}
    if args.init:
        steps["provision"] = provision_role_and_database()
        ensure_schema()
        steps["checkpoints"] = ensure_checkpoint_tables()
        steps["obsolete"] = drop_obsolete_objects()
        steps["ownership"] = ensure_ownership()
    else:
        ensure_schema()

    if args.admin:
        create_admin(args.admin, _read_password())

    counts = summary()
    report = verify()

    if args.json:
        print(json.dumps({"steps": steps, "counts": counts, "schema": report},
                         indent=2, default=str))
        return 0 if report["ready"] else 1

    print("database ready: " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"schema: {report['tables_present']}/{report['tables_expected']} tables, "
          f"pgvector {report['vector_version'] or 'MISSING'}")
    if report["missing_tables"]:
        print("  missing: " + ", ".join(report["missing_tables"]))
    if report.get("obsolete_present"):
        print("  obsolete objects still present: " + ", ".join(report["obsolete_present"]))
    print("  owners: " + ", ".join(f"{k}={v}" for k, v in report["table_owners"].items()))
    if args.init:
        prov = steps.get("provision", {})
        if prov.get("role_created"):
            print("  created role " + report["role"])
        if prov.get("database_created"):
            print("  created database " + report["database"])
        own = steps.get("ownership", {})
        if own.get("tables") or own.get("sequences"):
            print(f"  reassigned ownership: {own.get('tables', 0)} tables, "
                  f"{own.get('sequences', 0)} sequences")
    if counts["admins"] == 0:
        print("note: no administrator yet — run with --admin <username> before using the UI")
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
