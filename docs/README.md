# Documentation

Everything needed to run, use, administer and understand the IT Help Chatbot.
Start with the row that matches what you are trying to do.

| I am… | Read this |
| --- | --- |
| standing up the stack for the first time | [guides/SETUP.md](guides/SETUP.md) |
| a user asking IT questions | [guides/USER-GUIDE.md](guides/USER-GUIDE.md) |
| running the platform (admins, agents, domain owners) | [guides/ADMIN-GUIDE.md](guides/ADMIN-GUIDE.md) |
| trying to understand how the pieces fit | [architecture/SYSTEM.md](architecture/SYSTEM.md) |
| wondering why a question went to the wrong domain | [architecture/CLASSIFICATION.md](architecture/CLASSIFICATION.md) |
| tuning answer quality | [architecture/RAG-PIPELINE.md](architecture/RAG-PIPELINE.md) |
| wondering why a document was split the way it was | [architecture/CHUNKING.md](architecture/CHUNKING.md) |
| operating PostgreSQL + pgvector | [architecture/VECTOR-STORE.md](architecture/VECTOR-STORE.md) |
| operating Redis / Sentinel / Celery | [architecture/REDIS.md](architecture/REDIS.md) |
| asking why the reranker is slow (or why it is off) | [architecture/RERANKING.md](architecture/RERANKING.md) |
| changing the embedding model | [architecture/EMBEDDINGS.md](architecture/EMBEDDINGS.md) |

## Guides

- **[guides/SETUP.md](guides/SETUP.md)** — operation setup guide: prerequisites, secrets,
  images, apply order, first-boot checklist, health verification, upgrade and rollback.
- **[guides/USER-GUIDE.md](guides/USER-GUIDE.md)** — signing in, asking a question, reading
  citations, escalation to a ticket, feedback, history, what each confidence level means.
- **[guides/ADMIN-GUIDE.md](guides/ADMIN-GUIDE.md)** — roles and permissions, domains and
  routing, knowledge sync, integrations (Confluence, Jira, Keycloak, SMTP), the AI service,
  guardrails, the audit trail, and the dashboard.

## Architecture

- **[architecture/SYSTEM.md](architecture/SYSTEM.md)** — component map, trust boundaries,
  request lifecycle, deployment topology.
- **[architecture/RAG-PIPELINE.md](architecture/RAG-PIPELINE.md)** — the seven stages from
  question to answer, with the exact settings that govern each.
- **[architecture/CLASSIFICATION.md](architecture/CLASSIFICATION.md)** — LLM-first domain
  classification, the keyword fallback, the soft filter, and how a domain routes a ticket.
- **[architecture/CHUNKING.md](architecture/CHUNKING.md)** — header-aware chunking, overlap,
  context prefixes, and why 800 tokens.
- **[architecture/EMBEDDINGS.md](architecture/EMBEDDINGS.md)** — Ollama, `nomic-embed-text`,
  768 dimensions, batching.
- **[architecture/VECTOR-STORE.md](architecture/VECTOR-STORE.md)** — PostgreSQL + pgvector,
  the two LangChain tables, hybrid BM25 search, fusion.
- **[architecture/RERANKING.md](architecture/RERANKING.md)** — cross-encoder scoring, local
  vs remote mode, batching, the confidence blend.
- **[architecture/REDIS.md](architecture/REDIS.md)** — standalone vs Sentinel, Celery broker
  and result backend, caching, rate limits.

## Existing deep-dive material

Long-form references, kept current with the code:

| Document | Topic |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | original architecture notes |
| [DEPLOYMENT.md](DEPLOYMENT.md) | cluster deployment (long form) |
| [GETTING-STARTED.md](GETTING-STARTED.md) | local development |
| [OPERATIONS.md](OPERATIONS.md) | day-2 operations, backup, rollback |
| [PROJECT-STRUCTURE.md](PROJECT-STRUCTURE.md) | every directory explained |
| [GUARDRAILS.md](GUARDRAILS.md) | content policy and refusals |
| [monitoring.md](monitoring.md) · [observability.md](observability.md) | metrics, traces, logs |
| [postgres-backup-restore.md](postgres-backup-restore.md) | CNPG backups |
| [confluence-jira-setup.md](confluence-jira-setup.md) · [ldap-keycloak-setup.md](ldap-keycloak-setup.md) | integration setup |
| [tickets-and-approvals.md](tickets-and-approvals.md) | the ticket workflow |
| [domains.md](domains.md) | domain routing |
| [jira-reconciliation.md](jira-reconciliation.md) | mirroring Jira into the queue |
| [testing.md](testing.md) | running the full backend suite |
| [database-setup.md](database-setup.md) | PostgreSQL, pgvector, roles, schema bootstrap |
| [solution-architecture-explanation.md](solution-architecture-explanation.md) | the architecture in plain language |
| [architecture/security-guardrails-spec.md](architecture/security-guardrails-spec.md) | guardrail rules and their limits |

## Diagrams

| Diagram | Shows |
| --- | --- |
| [architecture-diagram.html](architecture-diagram.html) | the whole system on one page: workloads, data stores, external services, the two contract notes (one ticket form, the effective-configuration rail) |
| [architecture/rag-pipeline-6-stages.html](architecture/rag-pipeline-6-stages.html) | one question from guardrail to answer |
| [architecture/hybrid-search-bm25-pgvector.html](architecture/hybrid-search-bm25-pgvector.html) | dense + sparse retrieval, RRF, the gate |
| [architecture/rag-chunking-strategy.html](architecture/rag-chunking-strategy.html) | page → chunk → context prefix |
| [architecture/rag-reranker-architecture.html](architecture/rag-reranker-architecture.html) | the rerank split, batching and timing |

The four pipeline diagrams are regenerated from Mermaid sources with
`node frontend/scripts/arch-render.mjs`; the system diagram is hand-drawn SVG so it needs no
network and no font download.
