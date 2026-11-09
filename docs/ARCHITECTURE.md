# Architecture

## The shape of a request

```
Browser
  │  POST /api/chat/stream  (SSE)
  ▼
nginx (frontend)               same-origin proxy, no buffering
  ▼
FastAPI (backend)              auth → rate limit → guardrails → orchestrator
  │
  ├─ small talk?      → canned answer, no retrieval, no model call, no sources
  ├─ live lookup?     → deterministic tool answer (tickets / cluster / alerts)
  └─ otherwise        → LangGraph
                          classify → rewrite → retrieve → gate
                              ↑                    │
                              └──── retry ─────────┘  (weak retrieval)
                                            │
                                       context → generate (stream) → persist
```

The response is a stream of SSE events: `stage` (progress), `meta` (domain, confidence,
sources, retrieval telemetry), `token` (text), `caution` (low confidence), `done`.

## Retrieval

1. **Rewrite** — the question is reformulated for search (acronyms, domain vocabulary).
2. **Hybrid fetch** — dense (`pgvector`, cosine) + sparse (`BM25`) run over the same rows,
   each returning `RAG_FETCH_K` (32) candidates.
3. **Fusion** — Reciprocal Rank Fusion (k=60) merges the two ranked lists.
4. **Rerank** — `bge-reranker-base` scores each (query, chunk) pair on CPU, in `rerank-svc`.
   Only the first 600 characters of a chunk are scored: relevance barely changes past that
   and it cuts the batch cost ~3×.
5. **Gate** — a confidence decision (`answer` / `caution`) from the rerank margin plus
   `SIMILARITY_THRESHOLD` (0.55). `caution` keeps the answer but shows the banner.
6. **Top-K** — 5 chunks reach the prompt.

Every step is prepared to fail *downwards*: a dead reranker returns vector order, a dead
provider returns an error the UI can show. A broken dependency never produces a fabricated
answer.

## Escalation (conversation → reviewed draft → Jira)

`POST /api/escalations/draft` reads the conversation, keeps the turns that belong to the
issue (`select_relevant`), redacts secrets and personal data with the same patterns the
chat guardrail uses, and asks the model for a structured draft. It never calls Jira.

`POST /api/escalations/submit` posts exactly the fields that arrive — the server does not
regenerate the text between review and submit — and:

- validates project, issue type, priority and required custom fields against Jira
  `createmeta` (cached 60s) before calling it;
- refuses a draft whose `content_hash` no longer matches the one the form was opened with
  (another tab regenerated it);
- is idempotent per `idempotency_key`, so a double click or a retry returns the existing
  ticket instead of opening a second one;
- writes `audit_log.action = escalate.submitted` with draft id, conversation id, approved
  content hash and the resulting key, then appends the key and link to the transcript.

Defaults, deliberately: priority is left empty when the conversation does not state one,
`business_impact` stays empty unless the user said it, and unknowns are listed in
`Still needed` rather than guessed. When the LLM is unavailable the draft falls back to
quoting the user's own messages.

## Notifications

`GET /api/notifications` is the bell's only source. It is scoped to the caller and
derived from rows that already exist: pending approvals and LDAP-gated accounts for
admins/agents, decisions on the caller's own approvals, and tickets created from their
escalations. No notification table, no fan-out writes.

The UI may only say "You're all caught up" when that request succeeded — a failed poll
(429, expired token, network) shows "Couldn't load notifications" with a retry. Polling
pauses while the tab is hidden and backs off to 60s after a failure.

Rate limits: chat 10/min, escalations 5/min, login 5/min/IP, everything else 240/min per
user (all overridable with `RATE_LIMIT_*_PER_MIN`). The default tier is a runaway guard,
not a usage budget — one page load legitimately fires a few dozen reads.

## Data model (32 tables)

| Group | Tables | Notes |
| --- | --- | --- |
| Knowledge | `langchain_pg_collection`, `langchain_pg_embedding`, `kb_meta`, `semantica_entities`, `semantica_relations` | LangChain's PGVector store; embeddings are `vector(768)` |
| Chat | `chat_sessions`, `chat_messages`, `chat_attachments`, `feedback` | `chat_messages.meta` carries sources, confidence and usage per answer |
| Tickets | `jira_tickets`, `ticket_comments`, `ticket_attachments`, `approvals` | escalation is an approval-gated action |
| Identity | `users`, `local_user_credentials`, `departments`, `department_members`, `app_groups`, `app_group_members`, `user_settings` | directory users are mirrored, never given a password |
| Access | `rbac_matrix`, `user_permission_overrides`, `api_keys` | role → domain scope |
| Ops | `audit_log`, `runtime_kv`, `system_settings`, `classifier_domains` | `system_settings` is the write-only secrets store |
| LangGraph | `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` | conversation state for human-in-the-loop |

Schema lives in `backend/db/schema.sql`; `python -m app.bootstrap --init` applies it and is
idempotent.

## Background work

| Task | Schedule | What it does |
| --- | --- | --- |
| `sync_kb` | every 30 min | Confluence → articles → chunks → embeddings |
| `reconcile_jira` | daily 03:15 UTC | mirrors ticket status; cheap, no model calls |
| `backfill_domain_profiles` | daily 04:10 UTC | fills missing domain metadata |

`celery-beat` writes its schedule to `/tmp` (the container filesystem is read-only to the
process), and both worker and beat run as uid 10001.

## Security model

- **Authentication** — LDAP/AD bind (or a local credential for installs without a directory),
  optional Keycloak OIDC. JWT HS256, 30-minute access token, 14-day refresh.
- **Authorisation** — three roles (`admin`, `agent`, `user`), domain scoping per role, per-user
  overrides in `rbac_matrix` / `user_permission_overrides`.
- **Input guardrails** — ordered: size overflow → prompt injection (14 patterns with labels
  such as `instruction_override`, `role_hijack`, `data_exfiltration`) → PII → profanity →
  toxicity. Blocked requests never reach the model; every decision is written to `audit_log`
  and counted in `GUARDRAIL_EVENTS_TOTAL`.
- **Rate limiting** — 60 requests/minute per JWT subject (falling back to IP), plus stricter
  per-route tiers on login, chat and escalate. Redis-backed, fails open.
- **Secrets** — provider keys, Confluence/Jira tokens and SMTP passwords are stored in
  `system_settings` and are write-only over the API (`configured: true`, never the value).
  The API docs endpoints are disabled unless `API_DOCS_ENABLED=1`.
- **Containers** — every workload runs non-root with `allowPrivilegeEscalation: false` and all
  capabilities dropped.

Details: [architecture/security-guardrails-spec.md](architecture/security-guardrails-spec.md).

## Why it is built this way

| Decision | Reason |
| --- | --- |
| Postgres for vectors, not a separate vector DB | one backup, one restore path, one consistency model for chat + knowledge + audit |
| Embeddings and rerank run in-cluster | the knowledge base never leaves the network; only the final prompt does |
| Models baked into images | a fresh pod must not download 1.1GB before answering; also makes air-gap possible |
| rerank-svc separate from the backend | the reranker saturates CPU; isolating it keeps the API responsive and lets it scale alone |
| Redis Sentinel even in dev | the failover path is exercised before production needs it |
| Confidence gate instead of "best effort" | an honest `caution` banner beats a confident wrong answer |
| Small talk short-circuits retrieval | a greeting must not cite five documents at 0.5% — see `backend/app/smalltalk.py` |

## Diagrams

- `docs/architecture-diagram.html` — the whole system on one page
- `docs/architecture/rag-pipeline-6-stages.html` — request lifecycle
- `docs/architecture/hybrid-search-bm25-pgvector.html` — retrieval internals
- `docs/architecture/rag-chunking-strategy.html` — how pages become chunks
- `docs/architecture/rag-reranker-architecture.html` — rerank split and timing

Regenerate them with `node frontend/scripts/arch-render.mjs`.
