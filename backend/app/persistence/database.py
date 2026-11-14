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
    except Exception as exc:
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
        ("ticket_comments.jira_synced",
         "ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS jira_synced BOOLEAN"),
        ("kb_meta.body", "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS body TEXT"),
        ("kb_meta.updated_by", "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS updated_by VARCHAR(64)"),
        ("jira_tickets.subject", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS subject VARCHAR(200)"),
        ("jira_tickets.description", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS description TEXT"),
        ("jira_tickets.priority", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(16)"),
        # The board now speaks Jira's own workflow; `resolved`/`closed` were invented states
        # this project never had. One pass, idempotent.
        ("jira_tickets.status.legacy", "UPDATE jira_tickets SET status='done' "
                                       "WHERE status IN ('resolved', 'closed')"),
        ("domain_assignees", "CREATE TABLE IF NOT EXISTS domain_assignees ("
                             "id BIGSERIAL PRIMARY KEY, domain_key VARCHAR(64) NOT NULL, "
                             "principal_type VARCHAR(16) NOT NULL DEFAULT 'user', "
                             "principal VARCHAR(128) NOT NULL, "
                             "created_at TIMESTAMPTZ DEFAULT now(), "
                             "CONSTRAINT uq_domain_principal UNIQUE (domain_key, principal_type, principal))"),
        ("domain_assignees.idx", "CREATE INDEX IF NOT EXISTS ix_domain_assignees_domain_key "
                                 "ON domain_assignees (domain_key)"),
        ("jira_tickets.assignee", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS assignee VARCHAR(64)"),
        ("jira_tickets.due_date", "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ"),
        (
            "jira_tickets.remote_missing_at",
            "ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS remote_missing_at TIMESTAMPTZ",
        ),
        (
            "ticket_comments index",
            "CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket ON ticket_comments(ticket_id)",
        ),
        (
            "ticket_attachments.jira_attachment_id",
            "ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS jira_attachment_id VARCHAR(64)",
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
        # The settings API stores free-form UI preferences (darkMode, appName, …) as one
        # JSONB blob. The column was added to the queries but never to the model, so a
        # database created before it — and every fresh install, because create_all only
        # creates tables, never columns — answered "column prefs does not exist" with a 500
        # on /api/auth/me and /api/settings. Additive and idempotent.
        (
            "user_settings.prefs",
            "ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS prefs JSONB NOT NULL DEFAULT '{}'::jsonb",
        ),
        # Directory lifecycle (Phase 1): a users row is a projection of a directory account.
        # `state` says what the directory last told us; `missing_scans` debounces removals.
        ("users.display_name", "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(120)"),
        ("users.state", "ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(16) DEFAULT 'active'"),
        ("users.directory_seen_at",
         "ALTER TABLE users ADD COLUMN IF NOT EXISTS directory_seen_at TIMESTAMPTZ"),
        ("users.missing_scans",
         "ALTER TABLE users ADD COLUMN IF NOT EXISTS missing_scans INTEGER DEFAULT 0"),
        ("users.removed_at", "ALTER TABLE users ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ"),
        # Which Confluence space a page came from. `domain` is the routing category and
        # can be re-classified away from the space name, so it cannot stand in for this.
        ("kb_meta.space_key",
         "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS space_key VARCHAR(64)"),
        # Multi-site integrations: one row per Confluence/Jira site and its token.
        ("integration_connections",
         """CREATE TABLE IF NOT EXISTS integration_connections (
                id SERIAL PRIMARY KEY,
                provider VARCHAR(32) NOT NULL,
                label VARCHAR(120) NOT NULL,
                base_url VARCHAR(512) NOT NULL,
                email VARCHAR(255),
                api_token TEXT,
                cloud_id VARCHAR(64),
                spaces TEXT,
                project_key VARCHAR(32),
                active BOOLEAN DEFAULT TRUE,
                last_sync_at TIMESTAMPTZ,
                last_error TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (provider, base_url)
            )"""),
        ("integration_connections.site_uniq",
         "CREATE UNIQUE INDEX IF NOT EXISTS integration_connections_site_uniq "
         "ON integration_connections (provider, base_url)"),
        ("kb_meta.connection_id",
         "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS connection_id INTEGER"),
        ("kb_meta.site", "ALTER TABLE kb_meta ADD COLUMN IF NOT EXISTS site VARCHAR(255)"),
        (
            "integration_connections.sequence",
            "ALTER TABLE integration_connections ADD COLUMN IF NOT EXISTS sequence INTEGER DEFAULT 100",
        ),
        # One pass over a table that predates the column: without it every existing site would
        # show sequence 100 and the arrows would have nothing to swap against. Guarded so it
        # only fires while no sequence has ever been set.
        (
            "integration_connections.sequence.seed",
            "UPDATE integration_connections c SET sequence = r.rn FROM ("
            " SELECT id, row_number() OVER (PARTITION BY provider ORDER BY label, id) AS rn"
            " FROM integration_connections) r"
            " WHERE c.id = r.id AND NOT EXISTS ("
            " SELECT 1 FROM integration_connections WHERE sequence <> 100)",
        ),
        ("classifier_domains.confluence_connection_id",
         "ALTER TABLE classifier_domains ADD COLUMN IF NOT EXISTS confluence_connection_id INTEGER"),
        ("classifier_domains.jira_connection_id",
         "ALTER TABLE classifier_domains ADD COLUMN IF NOT EXISTS jira_connection_id INTEGER"),
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
            except Exception as exc:
                conn.rollback()
                logger.warning("could not create %s: %s", name, exc)

        for name, statement in _migrations:
            try:
                with conn.begin_nested():
                    conn.execute(text(statement))
                conn.commit()
            except Exception as exc:
                conn.rollback()
                # A missing vector-store table is expected before the first ingest; anything
                # else is worth a warning rather than a failed boot.
                level = logger.debug if "does not exist" in str(exc) else logger.warning
                level("migration %s skipped: %s", name, str(exc).splitlines()[0])



def get_session() -> Session:
    return SessionLocal()
