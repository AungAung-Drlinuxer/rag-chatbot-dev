# IT Help Chatbot — RAG assistant for internal IT

A self-hosted assistant that answers IT questions from **your** Confluence knowledge base,
with citations, live infrastructure lookups, guardrails and a full audit trail. Everything
runs inside one Kubernetes namespace; nothing leaves the cluster except the LLM calls you
configure.

```
Browser ──▶ frontend (nginx, SPA) ──▶ backend (FastAPI)
                                        ├─▶ PostgreSQL 16 + pgvector   knowledge, chat, audit
                                        ├─▶ Redis (Sentinel)           cache, broker, rate limits
                                        ├─▶ Ollama (nomic-embed-text)  embeddings
                                        ├─▶ rerank-svc (bge-reranker)  cross-encoder scoring
                                        ├─▶ Confluence / Jira / LDAP   sync, tickets, sign-in
                                        └─▶ LLM provider (Settings)    answer generation
```

## Start here

| I want to… | Read |
| --- | --- |
| run it on my laptop | [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) |
| stand it up on a **new cluster** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| understand how it works | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| keep it alive (backup, upgrade, rollback, logs) | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| know what every directory is for | [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md) |
| test or change the safety filters | [docs/GUARDRAILS.md](docs/GUARDRAILS.md) |
| learn the stack module by module | [docs/course/](docs/course/) |

## Repository layout

```
backend/            FastAPI app, RAG pipeline, workers, migrations, tests
frontend/           React 18 + Vite + Tailwind SPA (served by nginx)
services/rerank/    CPU cross-encoder service (bge-reranker-base over HTTP)
infra/
  k8s-dev/          the complete set of manifests (11 files, apply order = filename)
  images/ollama/    Dockerfile that bakes the embedding model into the Ollama image
  scripts/          render.py · create-secrets.sh · build-images.sh · deploy.sh
  monitoring/       Grafana dashboard JSON
docs/               deployment, operations, architecture, course material
```

## Features

- **Grounded answers** — hybrid retrieval (pgvector + BM25, fused with RRF), cross-encoder
  rerank, confidence gate, citations that open the real Confluence page.
- **Live lookups** — ticket status from the internal DB/Jira, cluster and alert state, without
  going through the LLM.
- **Guardrails** — prompt-injection, PII, profanity and volume checks; every event lands in
  `audit_log` and on the Overview board. See [docs/architecture/security-guardrails-spec.md](docs/architecture/security-guardrails-spec.md).
- **Roles & domains** — LDAP/AD sign-in, group→role mapping, per-role domain scoping.
- **Ops surface** — Overview dashboard (KPIs, cost, latency, guardrail events), Conversations,
  Audit log, Settings for integrations, AI service and SMTP.
- **Deployable anywhere** — all ten components ship as manifests; images are built from this
  repo, so an air-gapped cluster needs no external model download.

## Versions

| Piece | Where it is set |
| --- | --- |
| Backend image | `infra/env` → `BACKEND_TAG` |
| Frontend image | `infra/env` → `FRONTEND_TAG`, and `frontend/package.json` |
| App version shown by the API | `backend/pyproject.toml` (read at runtime from package metadata) |

## Conventions

- **No credentials in git.** Provider keys, Confluence/Jira tokens and SMTP passwords live in
  the database (Settings → Integrations) and are never returned by the API. Cluster secrets are
  created by `infra/scripts/create-secrets.sh`.
- **No mock data.** Every panel on the dashboard is fed by a real query; when a number is not
  available the UI shows `—`, not a placeholder.
- **Design tokens only** in the frontend (`var(--panel)`, `var(--accent)`, …), so light and dark
  themes stay consistent.

## Development gates

```bash
cd frontend && npm run build && npm run lint && npx vitest run && npx tsc --noEmit
cd ../backend && .venv/bin/pytest tests -q && .venv/bin/ruff check .
```

The suite skips (does not fail) tests that need a database when none is reachable — run
`docker compose -f backend/docker-compose.dev.yml up -d` first to exercise all of them.
