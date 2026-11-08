"""SQLAlchemy engine + session + DB init (vector extension, tables)."""
from __future__ import annotations

import logging

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import SETTINGS
from app.persistence.models import Base

logger = logging.getLogger("it-help-chatbot")

engine = create_engine(SETTINGS.database_url, future=True, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Ensure `vector` extension exists, then create all tables (idempotent).

    `CREATE EXTENSION` needs superuser on a database where pgvector has never been
    installed. An application role should not be a superuser, so that case is reported as
    an actionable instruction rather than a psycopg2 traceback.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    except Exception as exc:  # noqa: BLE001
        if "permission denied" in str(exc).lower() or "must be superuser" in str(exc).lower():
            raise RuntimeError(
                "the pgvector extension is not installed in this database, and the "
                "application role cannot create it. Run this once as a superuser, then "
                "start the app again:\n"
                "    CREATE EXTENSION IF NOT EXISTS vector;\n"
                f"(database: {SETTINGS.database_url.rsplit('@', 1)[-1]})"
            ) from exc
        raise
    Base.metadata.create_all(bind=engine)
    # The ORM covers 20 tables; these five are created by hand (they predate the models, or
    # they are key/value shapes that do not need one). They must exist on a fresh database
    # too — without `system_settings` there is nowhere to keep the LLM key, the integration
    # credentials or the JWT signing key, so the app would come up broken.
    _core_tables = [
        (
            "system_settings",
            "CREATE TABLE IF NOT EXISTS system_settings ("
            " key VARCHAR(64) PRIMARY KEY,"
            " value JSONB NOT NULL DEFAULT '{}'::jsonb,"
            " updated_at TIMESTAMPTZ DEFAULT now())",
        ),
        (
            "approvals",
            "CREATE TABLE IF NOT EXISTS approvals ("
            " id UUID PRIMARY KEY,"
            " username VARCHAR(64),"
            " question TEXT,"
            " status VARCHAR(16) DEFAULT 'pending',"
            " created_at TIMESTAMPTZ DEFAULT now(),"
            " decided_by VARCHAR(64),"
            " decided_at TIMESTAMPTZ,"
            " thread_id VARCHAR(64))",
        ),
        (
            "chat_attachments",
            "CREATE TABLE IF NOT EXISTS chat_attachments ("
            " id VARCHAR(40) PRIMARY KEY,"
            " session_id VARCHAR(64),"
            " username VARCHAR(64),"
            " filename TEXT,"
            " mime VARCHAR(128),"
            " size INTEGER,"
            " data BYTEA,"
            " created_at TIMESTAMPTZ DEFAULT now())",
        ),
        (
            "semantica_entities",
            "CREATE TABLE IF NOT EXISTS semantica_entities ("
            " id BIGSERIAL PRIMARY KEY,"
            " name TEXT NOT NULL,"
            " label TEXT,"
            " mentions INTEGER NOT NULL DEFAULT 0,"
            " page_ids TEXT[] NOT NULL DEFAULT '{}',"
            " source_urls TEXT[] NOT NULL DEFAULT '{}',"
            " method TEXT NOT NULL DEFAULT 'pattern')",
        ),
        (
            "semantica_relations",
            "CREATE TABLE IF NOT EXISTS semantica_relations ("
            " id BIGSERIAL PRIMARY KEY,"
            " subject TEXT NOT NULL,"
            " predicate TEXT NOT NULL,"
            " object TEXT NOT NULL,"
            " mentions INTEGER NOT NULL DEFAULT 0,"
            " page_ids TEXT[] NOT NULL DEFAULT '{}',"
            " source_urls TEXT[] NOT NULL DEFAULT '{}',"
            " method TEXT NOT NULL DEFAULT 'pattern')",
        ),
        (
            "ticket_comments",
            "CREATE TABLE IF NOT EXISTS ticket_comments ("
            " id BIGSERIAL PRIMARY KEY,"
            " ticket_id BIGINT NOT NULL,"
            " author VARCHAR(64),"
            " body TEXT NOT NULL,"
            " kind VARCHAR(16) DEFAULT 'comment',"
            " created_at TIMESTAMPTZ DEFAULT now())",
        ),
        (
            "ticket_attachments",
            "CREATE TABLE IF NOT EXISTS ticket_attachments ("
            " id BIGSERIAL PRIMARY KEY,"
            " ticket_id BIGINT NOT NULL,"
            " filename VARCHAR(255) NOT NULL,"
            " content_type VARCHAR(128),"
            " data BYTEA NOT NULL,"
            " size_bytes BIGINT NOT NULL,"
            " created_by VARCHAR(64),"
            " created_at TIMESTAMPTZ DEFAULT now())",
        ),
    ]

    # Best-effort migrations. Each statement runs in its own transaction: a single ALTER on
    # a table this database does not have yet (a fresh install has no vector store until the
    # first ingest) must not abort the rest of the plan.
    _migrations = [
        ("chat_messages.meta", "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta TEXT"),
        (
            "chat_sessions.connector_scope",
            "ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS connector_scope TEXT",
        ),
        ("kb_meta.body", "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS body TEXT"),
        ("kb_meta.updated_by", "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64)"),
        ("jira_tickets.subject", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS subject VARCHAR(200)"),
        ("jira_tickets.description", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS description TEXT"),
        ("jira_tickets.priority", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(16)"),
        ("jira_tickets.assignee", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS assignee VARCHAR(64)"),
        ("jira_tickets.due_date", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ"),
        (
            "ticket_comments index",
            "CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket ON ticket_comments(ticket_id)",
        ),
        (
            "ticket_attachments index",
            "CREATE INDEX IF NOT EXISTS ix_ticket_attachments_ticket ON ticket_attachments(ticket_id)",
        ),
        # Hybrid search (v0.10.0): FTS column + index over the vector store's chunk text.
        (
            "langchain_pg_embedding.tsv",
            "ALTER TABLE langchain_pg_embedding ADD COLUMN IF NOT EXISTS tsv tsvector",
        ),
        (
            "langchain_pg_embedding FTS index",
            "CREATE INDEX IF NOT EXISTS langchain_pg_embedding_tsv_idx "
            "ON langchain_pg_embedding USING gin (tsv)",
        ),
        (
            "langchain_pg_embedding.tsv backfill",
            "UPDATE langchain_pg_embedding SET tsv = to_tsvector('english', document) "
            "WHERE tsv IS NULL",
        ),
        # HNSW index for fast cosine search (needs pgvector >= 0.5).
        (
            "langchain_pg_embedding HNSW index",
            "CREATE INDEX IF NOT EXISTS langchain_pg_embedding_hnsw_idx "
            "ON langchain_pg_embedding USING hnsw (embedding vector_cosine_ops) "
            "WITH (m = 16, ef_construction = 64)",
        ),
    ]

    with engine.connect() as conn:
        for name, statement in _core_tables:
            try:
                with conn.begin_nested():
                    conn.execute(text(statement))
                conn.commit()
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                logger.warning("could not create %s: %s", name, exc)

        for name, statement in _migrations:
            try:
                with conn.begin_nested():
                    conn.execute(text(statement))
                conn.commit()
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                # A missing vector-store table is expected before the first ingest; anything
                # else is worth a warning rather than a failed boot.
                level = logger.debug if "does not exist" in str(exc) else logger.warning
                level("migration %s skipped: %s", name, str(exc).splitlines()[0])



def get_session() -> Session:
    return SessionLocal()
