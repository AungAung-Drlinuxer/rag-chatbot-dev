# Getting started — local machine

Goal: the stack running on your laptop with an empty database, then signed in as the first
administrator. About 10 minutes the first time.

You need: **Docker**, **Python 3.12** + [uv](https://docs.astral.sh/uv/), **Node 20+**.
Postgres, Redis and pgvector come from the compose file — no local install.

---

## 1. Database and cache

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 16)"   # keep it in this shell
docker compose -f backend/docker-compose.dev.yml up -d
```

That starts Postgres 16 + pgvector on `127.0.0.1:55433` and Redis on `127.0.0.1:6380`
(odd ports on purpose, so they cannot collide with anything else you run).

Check:

```bash
docker compose -f backend/docker-compose.dev.yml ps      # both healthy
```

## 2. Backend

```bash
cd backend
uv sync

export DATABASE_URL="postgresql+psycopg2://app:${POSTGRES_PASSWORD}@127.0.0.1:55433/assistant"
export REDIS_URL="redis://127.0.0.1:6380/0"
export OLLAMA_URL="http://127.0.0.1:11434"        # optional locally — see step 4

# create the schema (idempotent), then check what exists
uv run python -m app.bootstrap --init --json
uv run python -m app.bootstrap --check
```

Start the API. The JWT signing key is generated into the database on this first boot, so you
do not set one:

```bash
uv run uvicorn app.main:app --reload --port 8000
```

`http://127.0.0.1:8000/health` should answer.

## 3. First administrator

There is no default account. Create one locally (the password is prompted, never passed as
an argument):

```bash
uv run python -m app.bootstrap --admin jane.doe
```

Sign in with that username/password. Later users come from your directory (Settings →
Integrations → LDAP/AD) or from Users → invite.

## 4. Frontend

```bash
cd frontend
npm ci
npm run dev          # http://127.0.0.1:1420 — strict port, matches the Tauri dev URL
```

Vite proxies `/api` to `127.0.0.1:8000`, so the browser talks same-origin exactly like the
cluster does.

## 5. Make it answer

Nothing is seeded. An empty install starts, serves the UI and answers "I don't know".

1. **Settings → AI service** — provider, model, API key. Without this, chat returns a
   provider error.
2. **Settings → Integrations → Confluence** — base URL, email, API token, then
   **Knowledge → Sync**. Articles land in `articles`, chunks in `article_chunks`.
3. **Embeddings** — either run Ollama locally (`ollama pull nomic-embed-text`) and set
   `OLLAMA_URL`, or point `OLLAMA_URL` at the in-cluster service. The dimension is 768
   (`EMBEDDING_DIM`), which is what the schema expects; changing the model means re-indexing.
4. **Settings → Integrations → Jira** — only needed for "Create Jira ticket".

Test it end to end:

```bash
curl -s -X POST http://127.0.0.1:8000/api/chat/stream \
  -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"message":"how do I reset my VPN password","session_id":"<uuid>"}' | head -20
```

## 6. Tests

```bash
cd backend && uv run pytest -q tests        # DB-dependent tests skip if no database
cd frontend && npx vitest run && npm run build && npm run lint
```

---

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `psycopg2.OperationalError: connection refused` | compose not up, or `DATABASE_URL` port is not `55433` |
| `permission denied to create extension "vector"` | you pointed at a database where the role is not superuser; run `CREATE EXTENSION vector` as an admin once (the bundled CNPG cluster does this itself) |
| Login rejects a correct password | `DEV_ADMIN_USERNAMES` only grants the *role*; the user still needs a credential (`--admin`) or a directory |
| Chat answers "no provider configured" | Settings → AI service is empty |
| Answers cite nothing / "0 chunks" | KB never synced, or embeddings failed — check Settings → AI service → embedding test, and the `embeddings` count in `--check` |
| `npm run dev` port already in use | it is `strictPort: 1420`; stop the other process rather than changing the port (the Tauri config depends on it) |

More: [OPERATIONS.md](OPERATIONS.md) for the cluster, [ARCHITECTURE.md](ARCHITECTURE.md) for
how the pieces fit.
