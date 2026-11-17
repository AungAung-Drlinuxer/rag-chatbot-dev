# Running the test suite

The backend suite is mostly integration testing: it talks to a real PostgreSQL with pgvector,
a real Redis, and a real embedding model. None of that is required to *start* the suite, but
without it the database-backed tests cannot exercise the endpoints and they are skipped. This
page is the recipe that runs every test.

## What the suite needs

| Dependency | Why | Default the code expects |
| --- | --- | --- |
| PostgreSQL + pgvector | every endpoint test | `DATABASE_URL` |
| Redis | rate limiting, caching | `redis://127.0.0.1:6380/0` |
| Ollama with an embedding model | KB ingest tests | `OLLAMA_URL`, `nomic-embed-text` |

The repository ships a compose file for the first two:

```bash
cd backend
POSTGRES_PASSWORD=auditpw docker compose -f docker-compose.dev.yml up -d postgres redis
```

For the embedding model either run Ollama locally (`ollama pull nomic-embed-text`) or forward
the cluster service:

```bash
kubectl -n rag-chatbot-dev port-forward svc/ollama 11434:11434
curl -s http://127.0.0.1:11434/api/tags   # nomic-embed-text must be listed
```

## A database of its own

The suite deletes and re-seeds knowledge-base rows, so **never point it at a database you care
about**. Create a throwaway one per run:

```bash
docker exec it-help-chatbot-postgres-1 psql -U app -d assistant \
  -c "CREATE DATABASE assistant_test;"

cd backend
export DATABASE_URL='postgresql+psycopg2://app:auditpw@127.0.0.1:55433/assistant_test'
.venv/bin/python -m app.bootstrap --init     # 34 tables, pgvector extension
.venv/bin/python -m pytest tests -q
```

Expected, with all three dependencies up: **497 passed, 0 skipped** for the backend and
**267 passed** for the frontend (`cd frontend && npx vitest run`).

## What the suite configures for itself

`tests/conftest.py` sets three things before any `app.*` import, because the app reads them
once at import time:

- `JWT_SECRET` — a fixed test-only signing key, so tokens are reproducible.
- `DEV_ADMIN_USERNAMES=dev,ith@admin` — the promotion list. Empty means every admin endpoint
  answers 403 and the admin-surface tests can only fail.
- a per-test rate-limit reset — Redis keeps a fixed-window counter per client; without the
  reset the sixth login of the session is a 429 instead of the 401 the test expects.

## Skips you may still see

| Skip | Cause |
| --- | --- |
| `test_knowledge_api.py` (3) | Ollama is not answering or has no embedding model |
| everything in `test_admin_ops.py` | `DATABASE_URL` unreachable |

A skip is a missing dependency, not a passing test. If a run reports skips, the endpoint those
tests cover was not verified.
