# Project structure — what lives where

```
rag-chatbot/
├─ README.md                  entry point: what it is, where to start
├─ backend/                   FastAPI service (API + RAG + workers)
├─ frontend/                  React SPA served by nginx
├─ services/rerank/           standalone cross-encoder HTTP service
├─ infra/                     everything needed to run it on Kubernetes
└─ docs/                      deployment, operations, architecture, course
```

---

## backend/

```
app/
  main.py              FastAPI app factory: CORS, middleware, routers, lifespan
  config.py            every setting, one pydantic Settings class (env-driven)
  bootstrap.py         CLI: --init (schema), --check (report), --admin (first admin)
  graph_rag.py         LangGraph state machine (classify→rewrite→retrieve→gate→context→tools)
  orchestration/       run_rag(): the linear pipeline used when the graph fails
  rag/                 retrieval.py (hybrid fetch), bm25_index.py, reranker.py,
                       rewriter.py (query expansion), gate.py (confidence policy)
  api/                 one module per surface:
                         auth, chat, conversations, knowledge, tickets, users, settings,
                         dashboard, observability, admin, health, setup, domain_rename
  integrations/        confluence(.py, _write), jira, jira_reconcile, ticket_status,
                       rerank_client, contacts
  llm/client.py        provider adapters (OpenAI-compatible, Anthropic, local Ollama)
  security/            guardrails.py (injection/PII/profanity/toxicity),
                       rate_limit.py (per-user tiers + global middleware),
                       boot_secrets.py (seal/unseal the JWT key), api_keys.py
  auth/                jwt.py, deps.py (current user), rbac.py (roles → domains)
  persistence/         database.py (engine/session), models, repositories
  observability/       metrics.py (Prometheus), telemetry.py (OTLP traces)
  knowledge/           chunking, article store, sync orchestration
  tools/               live lookups: tickets, cluster, alerts
  smalltalk.py         greetings answered without retrieval
  notifier.py          SMTP alerts (approvals, escalations)
db/schema.sql          31 tables, the reference schema
workers/               celery_app.py (beat schedule) + sync_tasks.py
tests/                 240+ tests; DB-backed ones skip when no database is reachable
eval/                  gold-set Q/A used to score retrieval changes
scripts/               one-off operators: eval_goldset, verify_connector_scope, …
Dockerfile             uv-based build; model bake optional (BAKE_RERANKER)
docker-compose.dev.yml local Postgres+pgvector and Redis on odd ports
```

**Rule of thumb:** `api/` never talks to a model directly — it calls `orchestration/` or
`graph_rag.py`, which own the pipeline. `rag/` knows nothing about HTTP. `integrations/` owns
every external system, so an outage is one import away from a fallback.

## frontend/

```
src/
  App.tsx              routes + providers
  main.tsx             entry
  features/<domain>/   one folder per screen: pages/, components/, api.ts, model.ts
                       auth, chat, conversations, dashboard, domains, knowledge,
                       observability, settings, tickets, users, audits
  components/          shared UI: Composer, MarkdownMessage, HighlightedCode,
                       FloatingChat, CommandPalette, NotificationBell, ui/
  lib/                 http client, SSE parser, formatters
  shared/              cross-feature types and hooks
  styles.css           design tokens (light/dark) + Tailwind layers
nginx.conf             SPA fallback, /api proxy (SSE-safe), cache policy
vite.config.ts         dev server on :1420, /api proxy, vendor chunk split
scripts/arch-render.mjs regenerates the architecture diagrams in docs/
```

**Rule of thumb:** a screen is a `feature`. Anything used by two features moves up to
`components/` or `lib/`. Colours come from CSS tokens, never from Tailwind's palette.

## services/rerank/

The reranker is a separate deployment because it saturates CPU. `app.py` is ~120 lines:
`POST /v1/rerank`, `GET /health`, model baked into the image at build time.

## infra/

```
env.example            per-cluster values (namespace, registry, domain, tags, storage)
scripts/render.py      substitutes infra/env into the manifests → infra/.rendered/
scripts/create-secrets.sh   generates backend-secrets + postgres-dev-app (prints nothing)
scripts/build-images.sh     builds/pushes backend, frontend (+ rerank, ollama with --all)
scripts/deploy.sh           preflight → render → apply in order → verify
k8s-dev/               the manifests, numbered by apply order:
  00-namespace            the namespace
  05-config               ConfigMap: URLs, models, pipeline knobs
  10-preview              frontend Deployment/Service + Ingress
  15-db-init              Job: python -m app.bootstrap --init
  20-database             CloudNativePG Cluster (pgvector via postInitApplicationSQL)
  21-backup               ObjectStore + nightly ScheduledBackup (optional)
  30-backend              FastAPI Deployment + Service
  40-redis                Redis master + Sentinel + Services
  41-ollama               embedding runtime (model baked in the image)
  42-rerank               rerank-svc Deployment + Service
  43-celery               worker + beat
  45-monitoring           Alloy → Prometheus (optional)
images/ollama/         Dockerfile that bakes nomic-embed-text
monitoring/            Grafana dashboard JSON
```

## docs/

| File | Purpose |
| --- | --- |
| `GETTING-STARTED.md` | laptop → running, first admin, first answer |
| `DEPLOYMENT.md` | new cluster end to end, upgrade, rollback, air-gap |
| `OPERATIONS.md` | daily checks, backups, scaling, secret rotation, incidents |
| `ARCHITECTURE.md` | request lifecycle, data model, decisions |
| `PROJECT-STRUCTURE.md` | this file |
| `database-setup.md` | schema reference and provisioning detail |
| `postgres-backup-restore.md` | CNPG + barman restore walkthrough |
| `monitoring.md`, `observability.md` | metrics, traces, dashboards |
| `confluence-jira-setup.md`, `ldap-keycloak-setup.md` | integration setup |
| `domains.md`, `tickets-and-approvals.md`, `jira-reconciliation.md` | feature behaviour |
| `architecture/` | diagrams (HTML + PNG) and the guardrails spec |
| `design/` | UI references, including the Overview board spec |
| `course/` | 12-module teaching path through the stack |

**Course material is historical.** It walks the project as it was built, so it mentions
models and versions that have since changed (`bge-m3`, `llama3.2:1b`). For current behaviour,
the docs above are authoritative.

## Versioning

```
frontend/package.json   version = frontend image tag (also in infra/env FRONTEND_TAG)
backend/pyproject.toml  version = what the API reports (read from installed metadata)
infra/env               the tags actually deployed
```

Bump all three when releasing; `infra/env` is the one the cluster reads.
