"""Create the schema for a brand-new installation — and nothing else.

WHY THIS EXISTS
---------------
Pointing the app at an empty database already works (`init_db()` runs on startup), but a new
operator then has no way in: there is no default account, by design, and the first
administrator has to exist before the UI can be used. This module is that one step, and it
is deliberately the only thing that writes a row an operator did not create in the UI.

It never seeds content: no demo users, no sample articles, no placeholder domains, no
pre-filled settings. A fresh install is an empty workspace with one administrator.

USAGE
-----
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
import os
import secrets
import sys

from sqlalchemy import text

MIN_PASSWORD = 12


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
    parser.add_argument("--check", action="store_true", help="create the schema if missing, then report counts")
    parser.add_argument("--admin", metavar="USERNAME", help="create or promote this administrator")
    args = parser.parse_args(argv)

    if not args.check and not args.admin:
        parser.print_help()
        return 2

    ensure_schema()

    if args.admin:
        create_admin(args.admin, _read_password())

    counts = summary()
    print(
        "database ready: "
        + ", ".join(f"{k}={v}" for k, v in counts.items())
    )
    if counts["admins"] == 0:
        print("note: no administrator yet — run with --admin <username> before using the UI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
