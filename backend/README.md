# Backend — FastAPI + LangGraph + pgvector

The service behind every screen: authentication, RAG, live lookups, guardrails, tickets and
the audit trail.

```
app/api/          HTTP surface (one module per area)
app/graph_rag.py  LangGraph: classify → rewrite → retrieve → gate → context → tools
app/orchestration Linear pipeline (fallback when the graph fails)
app/rag/          retrieval (pgvector + BM25 + RRF), reranker, gate, rewriter
app/security/     guardrails, rate limits, JWT sealing, API keys
app/integrations/ Confluence, Jira, LDAP/AD, rerank client, ticket status
app/llm/          provider adapters with streaming + usage accounting
workers/          Celery tasks (KB sync every 30 min, Jira reconcile nightly)
db/schema.sql     the reference schema (31 tables)
```

Full map and rationale: [../docs/PROJECT-STRUCTURE.md](../docs/PROJECT-STRUCTURE.md) and
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Run it

```bash
uv sync
export DATABASE_URL='postgresql+psycopg2://app:<pw>@127.0.0.1:55433/assistant'
export REDIS_URL='redis://127.0.0.1:6380/0'
uv run python -m app.bootstrap --init            # schema (idempotent)
uv run python -m app.bootstrap --admin jane.doe  # first administrator
uv run uvicorn app.main:app --reload --port 8000
```

Step-by-step, including the compose file for Postgres/Redis:
[../docs/GETTING-STARTED.md](../docs/GETTING-STARTED.md).

## Configuration

Everything is an environment variable read by `app/config.py`; in Kubernetes they come from
the `backend-config` ConfigMap and the `backend-secrets` Secret. The values that change per
install:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Postgres + pgvector (secret) |
| `REDIS_URL` / `REDIS_SENTINELS` / `REDIS_PASSWORD` | cache, broker, rate limits |
| `OLLAMA_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIM` | embeddings (768 for `nomic-embed-text`) |
| `RERANK_ENABLED`, `RERANK_MODE` (`remote`/`local`), `RERANK_URL` | reranking |
| `RAG_FETCH_K`, `RAG_TOP_K`, `SIMILARITY_THRESHOLD`, `HYBRID_ENABLED` | retrieval tuning |
| `LANGGRAPH_ENABLED` | `1` = graph pipeline, `0` = linear |
| `RBAC_ADMIN_GROUPS`, `RBAC_AGENT_GROUPS`, `DEV_ADMIN_USERNAMES` | who is an admin/agent |
| `LDAP_*`, `CONFLUENCE_*` | directory and knowledge-source defaults |
| `API_DOCS_ENABLED` | expose `/docs` (off by default) |

## Secrets — nothing sensitive in the repo

This service is meant to be stood up by another team against **their own** systems, so the
repository ships no credentials, no domain names and no accounts.

| What | Where it lives | How a new install gets it |
| --- | --- | --- |
| Database URL (may contain a password) | `DATABASE_URL` env / Kubernetes Secret | set once at install |
| JWT signing key | `system_settings["security"].jwt_secret` in the database | **generated automatically on first boot**; `JWT_SECRET` in the env overrides it |
| LLM provider key + model + base URL | `system_settings["llm"]` | Settings → AI service |
| LDAP / AD, Keycloak SSO, Confluence, Jira | `system_settings["<provider>"]` | Settings → Integrations |
| SMTP | `system_settings["smtp"]` | Settings → Email server |
| Mail domain for a synthesised address | `MAIL_DOMAIN` env, optional | set if your directory has no `mail` attribute |

There is **no default account and no default password.** Authentication comes from the
directory you configure, or from a local credential an administrator sets
(`local_user_credentials`, salted hash). To make that account an administrator on an install
without a directory, set `DEV_ADMIN_USERNAMES=<username>` (comma-separated) and restart.

Stored secrets are write-only over the API: `GET /api/settings/integrations/{key}` returns
`configured` flags, never values.

An installation with nothing configured still starts and serves the UI; it simply cannot
answer questions or log anyone in until a provider and a directory (or a local credential)
exist. Nothing is pre-seeded with sample content.

Schema reference and provisioning detail: [../docs/database-setup.md](../docs/database-setup.md).

## Commands

```bash
uv run python -m app.bootstrap --check          # tables, users, admins — no secret values
uv run python -m app.bootstrap --admin <user>   # create or promote (password via prompt/stdin)
uv run pytest -q tests                          # DB tests skip when no database is reachable
uv run ruff check .
```

Celery locally:

```bash
uv run celery -A workers.celery_app worker -l info
uv run celery -A workers.celery_app beat  -l info
```

## Image

```bash
docker build -t <registry>/backend:<tag> .
# with the reranker baked in (only when RERANK_MODE=local):
docker build --build-arg BAKE_RERANKER=1 -t <registry>/backend:<tag> .
```

Runs as uid 10001; the only runtime write is Celery's schedule file in `/tmp`. Uploads are
stored in Postgres, not on a volume.
