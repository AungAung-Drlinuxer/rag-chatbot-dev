# Observability (in-app, no Grafana)

`Operations → Observability` answers the questions the Grafana boards answered — tokens, cost,
latency, guardrail activity, dependency health — using only tables this application writes.
It needs no Prometheus, Loki, Tempo, Mimir or Grafana.

## Where every number comes from

| Panel | Source | Notes |
|---|---|---|
| Answers | `llm_usage` | one row per answered question |
| Tokens in / out | `llm_usage.input_tokens / output_tokens` | provider usage, as reported by the model |
| Estimated cost | `llm_usage.cost_usd` | computed at write time from the app's price table |
| p50 / p95 / max latency | `llm_usage.latency_ms` | `percentile_cont` in SQL, not an average of averages |
| Tokens per day, Cost per day | `llm_usage` grouped by day | empty days are drawn as zero, not omitted |
| Decisions | `llm_usage.decision` | `answer`, `caution`, `escalate`, … |
| Tokens by model | `llm_usage.model` | top 5 by cost |
| Guardrails | `audit_log` where `action LIKE 'guardrail.%'` | same source the Prometheus gauge reads |
| Recent guardrail events | `audit_log` | **admin only** — it carries usernames and prompt text |
| Service health | `GET /api/dashboard/health` | reused, not re-probed |
| KB / open tickets / users | `kb_meta`, `jira_tickets`, `users` | point-in-time counts |

## Why a table and not a counter

Prometheus counters live in process memory. They reset on every pod restart, they are per-pod
(so a 2-replica deployment needs `sum by (...)` to be meaningful), and they cannot answer "what
did we spend last month". `llm_usage` is written once per answer and survives restarts, replica
counts and redeploys.

The cost is one INSERT per answer, best-effort: if it fails, the chat answer already streamed
is unaffected and a warning is logged. `record_usage()` never raises.

## What the page deliberately does not show

- **Node CPU / container memory / pod restarts** — these numbers do not exist in the database.
  They come from cAdvisor and kube-state-metrics. The page omits them rather than estimating.
- **A live log stream** — the audit log holds security events, not application stdout.
- **Per-request traces** — Langfuse or Tempo territory; not reconstructed here.

If those become requirements, keep the Alloy → Prometheus scrape (see
[`monitoring.md`](monitoring.md)) and either keep Grafana for them or add a backend query proxy.

## Cost caveat

Cost is the application's estimate: `tokens × price table` from `app/observability/metrics.py`.
It is a budgeting aid, not the provider invoice. If the price table is stale, this page is
wrong in the same way the `/metrics` counter is wrong — one table, two readers, never two
different numbers.

## API

- `GET /api/observability/overview?days=7` (1–90) — totals, series, by-model, decisions,
  domains, guardrails, counts.
- `GET /api/observability/overview?start=2026-11-01&end=2026-11-07` — custom range; a `YYYY-MM-DD`
  end date includes the whole day.
- `GET /api/observability/events?limit=25` — recent guardrail rows (admin).

Both require a logged-in user; the events list additionally requires `admin`.

## Range semantics

Windows are `created_at >= start AND created_at < end`, so two adjacent windows never both count
the same answer. Ranges are capped at 366 days and the cheap `days` parameter is clamped to 90.

## Verifying after a deploy

```bash
kubectl -n rag-chatbot-dev exec deploy/backend -- python - <<'PY'
from sqlalchemy import text
from app.persistence.database import SessionLocal
with SessionLocal() as s:
    print(s.execute(text("select count(*), coalesce(sum(cost_usd),0) from llm_usage")).one())
PY
```

Ask one question in the chat, then reload `Operations → Observability`: `Answers` goes up by one
and the row appears under "Recent guardrail events" only if it was refused.
