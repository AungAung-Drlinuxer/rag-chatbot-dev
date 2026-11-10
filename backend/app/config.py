"""Application settings (env / .env) via pydantic-settings."""
from __future__ import annotations

import logging

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_log = logging.getLogger(__name__)


def _resolve_openbao_overrides() -> dict[str, str]:
    """Try to read secrets from OpenBao (k8s-auth + KV). On any failure
    return {} so the caller falls back to env vars (k8s Secret).

    Kept lazy-imported so that local dev / unit tests don't require httpx
    or pod-internal paths.
    """
    try:
        from app.secrets import openbao as _openbao
        data = _openbao.load()
    except Exception as exc:
        _log.info("openbao resolver unavailable: %s", exc)
        return {}
    return data or {}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Core
    app_env: str = "dev"
    # /docs, /redoc and /openapi.json are a complete map of the API. Off by default;
    # set API_DOCS_ENABLED=1 in a dev environment when you actually want them.
    api_docs_enabled: bool = False

    # Data stores — use port 55433 so it does NOT collide with onprem-ai-assistant (55432)
    # No credentials in the image: the password (if the server needs one) comes from
    # DATABASE_URL, which the operator supplies at install time.
    database_url: str = "postgresql+psycopg2://app@127.0.0.1:55433/assistant"
    ollama_url: str = "http://localhost:11434"
    redis_url: str = "redis://localhost:6380/0"   # Phase 7 (broker/cache; isolated port)
    redis_mode: str = "standalone"                # standalone | sentinel (Redis Sentinel HA)
    redis_sentinels: str = ""                     # "host1:26379,host2:26379,host3:26379"
    redis_master_name: str = "mymaster"
    redis_password: str = ""

    # Embeddings (Ollama CPU)
    embedding_model: str = "nomic-embed-text"
    embedding_dim: int = 768

    # Models Provider (Claude-compatible external API) — no local LLM, no GPU
    hchat_base_url: str = Field("", validation_alias=AliasChoices("HCHAT_BASE_URL", "H_CHAT_BASE_URL", "hchat_base_url"))
    hchat_api_key: str = Field("", validation_alias=AliasChoices("HCHAT_API_KEY", "H_CHAT_API_KEY", "hchat_api_key"))
    hchat_model: str = Field("claude-4.6", validation_alias=AliasChoices("HCHAT_MODEL", "H_CHAT_MODEL", "hchat_model"))
    hchat_provider: str = Field("anthropic", validation_alias=AliasChoices("HCHAT_PROVIDER", "H_CHAT_PROVIDER", "hchat_provider"))
    llm_max_tokens: int = 4096             # v1.6.21 — 2048 truncated long guides mid-sentence (~3k chars ceiling)

    # Phase 10 — fault-tolerant LLM fallback (provider → local Ollama → dev mock)
    fallback_enabled: bool = True
    fallback_llm_model: str = "llama3.2:3b"   # v1.6.24 — 3b has markedly better quality than 1b (still CPU-fit)

    # Auth (LDAP + JWT) — Phase 5
    ldap_url: str = ""                # ldaps://ldap.example.com:636
    ldap_base_dn: str = ""            # dc=example,dc=com
    ldap_bind_dn: str = ""            # service bind (search) DN
    ldap_bind_password: str = ""
    ldap_upn_suffix: str = ""                 # empty -> derived from ldap_base_dn
    ldap_user_filter: str = "(sAMAccountName={username})"   # AD; use (uid={username}) for OpenLDAP
    # Empty -> generated once per install and kept in system_settings.security
    # (app/security/boot_secrets.py). Never ship a default signing key.
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"

    # OIDC single sign-on (Keycloak). Settings → Integrations → Keycloak writes the same
    # fields into `system_settings.keycloak`; these are the env fallback for cluster installs.
    keycloak_issuer: str = ""
    keycloak_realm: str = ""
    keycloak_client_id: str = ""
    keycloak_client_secret: str = ""
    keycloak_redirect_uri: str = ""
    access_token_minutes: int = 30
    refresh_token_days: int = 14

    # RBAC / ACL (Phase 9)
    rbac_enabled: bool = True
    rbac_admin_groups: str = "it-help-admins"    # space-separated LDAP groups → admin
    rbac_agent_groups: str = "it-help-agents"
    dev_admin_usernames: str = ""               # install-specific; set via env when needed
    # role=domains (comma-sep per role; "*" = all). Roles are user / knowledge / admin
    # (the old "agent" entry is gone; a leftover makes no difference — it matches nothing).
    # v1.6.34 — `knowledge` was absent from this map, so allowed_domains() returned an
    # EMPTY set and a Knowledge Manager saw no KB content at all in chat (every chunk
    # was filtered out by the domain gate). They curate the whole base, so they get
    # unrestricted READ; write/manage authority stays with the capability map.
    role_domains: str = (
        "user=general,system;"
        "knowledge=*;"
        "admin=*"
    )
    # domain=project,assignee — per-domain Jira routing. e.g. "database=IT,db-lead;network=IT,net-lead"
    domain_jira_routing: str = ""

    # Observability — external LGTM (Phase 8). Empty → telemetry becomes a no-op.
    tempo_otlp_url: str = ""        # http://tempo:4318/otlp/v1/traces
    mimir_otlp_url: str = ""        # http://mimir:4318/otlp/v1/metrics
    loki_url: str = ""              # http://loki:3100/loki/api/v1/push
    service_name: str = "it-help-chatbot"

    # Mail — used only to synthesise an address for a user the directory has no mail for.
    mail_domain: str = ""

    # CORS (Phase 10 web/mobile + dev) — comma-separated allowed origins
    cors_origins: str = "http://localhost:1420,http://127.0.0.1:1420,http://127.0.0.1:4173,tauri://localhost,http://tauri.localhost"

    # RAG
    confidence_gate_threshold: float = 0.75
    retrieval_top_k: int = 5
    # v1.6.50 — how many fused candidates are sent to the cross-encoder.
    # Measured: 20 candidates x 2000 chars took 27s per call on this CPU-only
    # cluster, so the 8s client budget made EVERY rerank fail and silently
    # fall back to vector order. Re-scoring the long tail does not change the
    # top-5 outcome, so the batch is bounded here.
    rerank_max_docs: int = 10

    rerank_enabled: bool = True
    rerank_model: str = "BAAI/bge-reranker-base"
    # v0.22.x — Option A split: "local" scores in-process (baked model),
    # "remote" calls rerank-svc over the cluster network. Flip via ConfigMap
    # RERANK_MODE without rebuilding; on failure it falls back to vector order.
    rerank_mode: str = "local"                  # local | remote
    rerank_url: str = "http://rerank-svc:8080"  # in-cluster Service DNS only (air-gapped safe)
    rerank_timeout_s: float = 30.0   # cluster A/B: 8-doc batch ≈ 10-13s on CPU nodes
    rerank_api_key: str = ""
    # v0.21.54 — 20 candidates × ~3s CPU scoring = the whole rerank stage alone was
    # 50s per request. 8 is plenty for RRF-fused top-k=5.
    rerank_candidates: int = 8
    rerank_device: str = "cpu"
    hybrid_enabled: bool = True
    hybrid_keyword_limit: int = 20
    chunk_tokens: int = 800
    chunk_overlap: float = 0.10
    embed_batch_size: int = 32

    # LLM context window — assembled prompt must fit comfortably in the model's
    # input. This is a soft cap: the RAG context (KB chunks + query header) is
    # truncated to roughly `max_context_tokens` before being handed to the LLM.
    # Tune per provider: Claude 4.x ≈ 200k, GPT-4o ≈ 128k, OpenRouter free models vary.
    max_context_tokens: int = 60000
    # Approximate chars per token for English text. 4 is a conservative midpoint
    # (real ratios are 3.5–5.0) so we never *under*-truncate.
    chars_per_token: int = 4

    # Confluence
    confluence_base_url: str = ""
    confluence_email: str = ""  # only used as username for non-Bearer paths
    confluence_token: str = ""   # API token (used as Bearer for cloud-id gateway)
    confluence_cloud_id: str = ""  # Atlassian Cloud ID (for unified API gateway)
    confluence_space_keys: str = "HELP"

    # Phase 7 — multi-source KB: file shares / runbooks (local dir; txt/md/pdf/docx)
    fileshare_dir: str = "kb_files"
    fileshare_domain: str = "system"

    # Jira
    jira_base_url: str = ""
    jira_email: str = ""
    jira_token: str = ""
    jira_project: str = "ITHD"
    jira_service_desk_id: str = ""
    jira_request_types: str = ""  # JSON: {"server":"101","network":"102",...}

    # IT team leads — {domain: {name,email,phone}} (Phase 1 contact info)
    it_contacts: dict[str, dict[str, str]] = {
        "database": {"name": "Alice Chen", "email": "db-lead@example.com", "phone": "+65-555-1001"},
        "network": {"name": "Bob Malik", "email": "net-lead@example.com", "phone": "+65-555-1002"},
        "security": {"name": "Carol Nguyen", "email": "sec-lead@example.com", "phone": "+65-555-1003"},
        "system": {"name": "Dave Osei", "email": "srv-lead@example.com", "phone": "+65-555-1004"},
    }


_OPENBAO_OVERRIDES = _resolve_openbao_overrides()
if _OPENBAO_OVERRIDES:
    SETTINGS = Settings(**_OPENBAO_OVERRIDES)
else:
    SETTINGS = Settings()
