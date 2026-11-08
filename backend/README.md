# IT Help Chatbot — Backend (FastAPI + LangGraph + PGVector)

Core AI assistant service implementing LangGraph RAG, hybrid search with BM25s Okapi, and full telemetry integration.

---

## 🚀 Key Modules & Capabilities

- **LangGraph StateGraph:** Multi-stage graph handling classification, query rewriting, hybrid retrieval, confidence gating, tool calling, and human-in-the-loop interruption.
- **Hybrid Retrieval Pipeline:**
  - **Dense Semantic:** Dense embeddings (`bge-m3:latest`, 1024-dim) via Ollama with PostgreSQL HNSW indexing.
  - **Sparse Lexical:** In-memory BM25s Okapi engine (< 1.5ms, CPU-only) with automatic invalidation on article ingest or delete.
  - **RRF & Reranking:** Reciprocal Rank Fusion ($k=60$) blended with Cross-Encoder deep scoring (`rerank-svc:8080`).
- **Fault-Tolerant LLM & Fallback:**
  - Primary provider: Configurable OpenAI/OpenRouter/Anthropic gateway with streaming token usage tracking.
  - Local fallback: Local Ollama on-prem execution with `llama3.2:1b` model.
- **OpenTelemetry & Prometheus Exporter:**
  - Distributed traces exported to Tempo (`:4318`) with granular sub-spans.
  - Standard `/metrics` endpoint scraped by Grafana Alloy for token usage, estimated costs, and feedback ratings.

---

## 🔐 Configuration & secrets — nothing sensitive in the repo

This service is meant to be stood up by another team against **their own** systems, so the
repository ships no credentials, no domain names and no accounts.

| What | Where it lives | How a new install gets it |
| --- | --- | --- |
| Database URL (may contain a password) | `DATABASE_URL` env / Kubernetes Secret | set once at install |
| JWT signing key | `system_settings["security"].jwt_secret` in the database | **generated automatically on first boot**; `JWT_SECRET` in the env overrides it if you rotate keys through your own secret manager |
| LLM provider key + model, Base URL | `system_settings["llm"]` | Settings → AI service |
| LDAP / AD, Keycloak SSO, Confluence, Jira | `system_settings["<provider>"]` | Settings → Integrations |
| SMTP | `system_settings["smtp"]` | Settings → Email server |
| Mail domain used to synthesise a missing address | `MAIL_DOMAIN` env, optional | set if your directory has no `mail` attribute |

There is **no default account and no default password.** Authentication comes from the
directory you configure, or from a local credential an administrator sets
(`local_user_credentials`, hashed). To make the first user an administrator on an install
without a directory, set `DEV_ADMIN_USERNAMES=<that username>` (accepts a comma-separated
list) and log in with the credential you set for it.

Secrets that are already stored are write-only over the API: `GET
/api/settings/integrations/{key}` returns `configured` flags, never values.

### First run

```bash
# 1. a database with pgvector (any Postgres 16 + pgvector 0.8 will do)
export DATABASE_URL='postgresql+psycopg2://app:<password>@<host>:5432/assistant'

# 2. start the API — the signing key is minted into the database on this boot
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. open the UI, sign in as the administrator, and fill in Settings → Integrations
```

An installation with nothing configured still starts and serves the UI; it simply cannot
answer questions or log anyone in until a provider and a directory (or a local credential)
exist. Nothing is pre-seeded with sample content.

The full walkthrough — required Postgres/pgvector versions, the 31-table reference schema
(`db/schema.sql`), the first-administrator step, verification queries and the upgrade path —
is [docs/database-setup.md](../docs/database-setup.md).

---

## 🛠️ Verification & Build Commands

```bash
# Compile check
uv run python -m py_compile app/main.py

# Tests (the API tests need a reachable database)
DATABASE_URL=... uv run python -m pytest -q

# Docker Container Build (dev line / production line use different Harbor projects)
docker build -t harbor.drlinuxer.com/rag-chatbot-dev/backend:<tag> .
docker build -t harbor.drlinuxer.com/rag-chatbot/backend:<tag> .
```
