"""SQLAlchemy ORM models matching the design-doc schema.

Users · chat_sessions · chat_messages · jira_tickets · feedback.
The vector KB is managed by LangChain PGVector (its own `langchain_pg_embedding`
table is the equivalent of the doc's `confluence_embeddings`).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import (
    Integer,
    Boolean,
    Text,
    JSON,
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    SmallInteger,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    ldap_dn: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(128))
    # v0.21.7 — admin-controlled RBAC fields
    status: Mapped[str] = mapped_column(String(16), default="Active", server_default="Active")
    role_override: Mapped[str | None] = mapped_column(String(32))  # admin | agent | user
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[str] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(64))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # v0.21.38 — conversation management
    title: Mapped[str | None] = mapped_column(String(200))
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # JSON array of connector names this conversation is restricted to. NULL/"" = every
    # enabled server, which is what every conversation meant before this column existed.
    connector_scope: Mapped[str | None] = mapped_column(Text)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[str] = mapped_column(Uuid(as_uuid=True), ForeignKey("chat_sessions.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[str | None] = mapped_column(Text)  # {domain,confidence,decision,hits} for assistant msgs
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JiraTicket(Base):
    __tablename__ = "jira_tickets"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[str | None] = mapped_column(Uuid(as_uuid=True))
    jira_key: Mapped[str | None] = mapped_column(String(64))
    domain: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str | None] = mapped_column(String(32))
    created_by: Mapped[str | None] = mapped_column(String(64))
    # v0.16.0 — manual ticket fields (nullable: chat escalations leave them NULL)
    subject: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str | None] = mapped_column(String(16))
    assignee: Mapped[str | None] = mapped_column(String(64))          # v0.20.0
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # v0.20.0
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TicketComment(Base):
    __tablename__ = "ticket_comments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(BigInteger, index=True)  # jira_tickets.id
    author: Mapped[str | None] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default="comment")  # comment|status|assignee|edit
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(BigInteger, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(128))
    data: Mapped[bytes] = mapped_column()
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    created_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    message_id: Mapped[str | None] = mapped_column(String(255))
    rating: Mapped[int | None] = mapped_column(SmallInteger)  # 1 helpful, -1 not
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KbMeta(Base):
    """Sync bookkeeping (Phase 7) — tracks per-page content hash for change-detection.

    The vectors live in the PGVector store (`langchain_pg_embedding`); this table only
    records what has been ingested so a repeat sync can skip unchanged pages.
    """
    __tablename__ = "kb_meta"
    page_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(String(512))
    body: Mapped[str | None] = mapped_column(Text)          # source body (Knowledge edit/list UI)
    source_url: Mapped[str | None] = mapped_column(String(1024))
    updated_by: Mapped[str | None] = mapped_column(String(64))   # who last synced/edited
    last_synced: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiKey(Base):
    """v1.1.8 — External API keys for programmatic chat access.

    Users/automation integrate via `Authorization: Bearer ith_xxx` instead of a
    JWT login. Keys are stored HASHED (sha256) — the raw value is shown once at
    creation. Scope limits exposure: 'chat' allows only the chat/conversation
    endpoints; 'read' adds read-only KB listing. Rate limits apply per key.
    """
    __tablename__ = "api_keys"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)          # label, e.g. "ops-bot"
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    key_prefix: Mapped[str] = mapped_column(String(16), nullable=False)     # ith_ab12…  (display)
    scope: Mapped[str] = mapped_column(String(32), nullable=False, default="chat")  # chat | readonly
    owner: Mapped[str] = mapped_column(String(64), nullable=False)          # admin who created
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RuntimeKv(Base):
    """Key-value overrides for settings that admins want to change at runtime
    (without re-deploying). Loaded at request time by `runtime.get()` and
    persisted via `runtime.set()`. Backed by Postgres so it survives restarts.
    """
    __tablename__ = "runtime_kv"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AuditLog(Base):
    """Audit trail (Phase 8) — every high-value action: chat / escalate / feedback / sync."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False)   # chat/escalate/feedback/login/sync
    username: Mapped[str | None] = mapped_column(String(64))
    domain: Mapped[str | None] = mapped_column(String(64))
    confidence: Mapped[float | None] = mapped_column(Float)
    decision: Mapped[str | None] = mapped_column(String(16))
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UserSettings(Base):
    """Per-user UI preferences + escalation defaults (Phase 10.1).

    The row is keyed on `username` (matches JWT `sub`). A row is created on first
    read of `/api/settings` for that user, so callers always get a full payload.
    """
    __tablename__ = "user_settings"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Appearance
    theme: Mapped[str] = mapped_column(String(16), default="system")            # light|dark|system
    density: Mapped[str] = mapped_column(String(16), default="comfortable")   # comfortable|compact
    chat_font_size: Mapped[int] = mapped_column(SmallInteger, default=14)
    # Chat behavior
    show_token_usage: Mapped[bool] = mapped_column(default=True)
    show_rag_sources: Mapped[bool] = mapped_column(default=True)
    stream_responses: Mapped[bool] = mapped_column(default=True)
    markdown_rendering: Mapped[bool] = mapped_column(default=True)
    auto_escalate_on_caution: Mapped[bool] = mapped_column(default=False)
    history_retention_days: Mapped[int] = mapped_column(SmallInteger, default=30)
    # Escalation
    escalate_include_transcript: Mapped[bool] = mapped_column(default=True)
    escalate_include_sources: Mapped[bool] = mapped_column(default=True)
    escalate_open_new_tab: Mapped[bool] = mapped_column(default=True)
    # Code style
    code_font: Mapped[str] = mapped_column(String(32), default="JetBrains Mono")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RbacMatrix(Base):
    """v0.21.14 — admin-editable role permission matrix.
    role is the primary key; permissions is a JSON dict (boolean per capability).
    Default permissions (when no row exists) are returned by the API."""
    __tablename__ = "rbac_matrix"
    role: Mapped[str] = mapped_column(String(32), primary_key=True)
    permissions: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(64))


class UserPermissionOverride(Base):
    """v0.21.58 — per-user capability overrides on top of the role matrix.
    Admin assigns a role (base), then may tick extra permissions for that one user."""
    __tablename__ = "user_permission_overrides"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    permissions: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(64))


class AppGroup(Base):
    """v0.21.58 — admin-managed groups. Members inherit the group's role+permissions."""
    __tablename__ = "app_groups"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="user")  # admin|agent|knowledge|user
    permissions: Mapped[dict | None] = mapped_column(JSON)  # optional extra caps for members
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GroupMember(Base):
    __tablename__ = "app_group_members"
    group_name: Mapped[str] = mapped_column(String(64), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), primary_key=True)


class Department(Base):
    """v0.21.58 — admin-managed departments; users and/or groups can belong."""
    __tablename__ = "departments"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    description: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DepartmentMember(Base):
    __tablename__ = "department_members"
    department: Mapped[str] = mapped_column(String(64), primary_key=True)
    member_type: Mapped[str] = mapped_column(String(8), primary_key=True)  # user | group
    member_name: Mapped[str] = mapped_column(String(64), primary_key=True)


class LocalUserCredential(Base):
    """v0.21.58 — password for LOCAL users only. LDAP users authenticate in AD."""
    __tablename__ = "local_user_credentials"
    username: Mapped[str] = mapped_column(String(64), primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="local")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ClassifierDomain(Base):
    """Admin-managed domains and keywords for dynamic classification."""
    __tablename__ = "classifier_domains"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    domain_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    keywords: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    jira_project: Mapped[str | None] = mapped_column(String(32))
    jira_assignee: Mapped[str | None] = mapped_column(String(64))
    icon: Mapped[str | None] = mapped_column(String(32), default="BookOpen", server_default="BookOpen")
    color: Mapped[str | None] = mapped_column(String(32), default="blue", server_default="blue")
    custom_icon: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
