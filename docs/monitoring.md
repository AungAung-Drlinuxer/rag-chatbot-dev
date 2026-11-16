# Monitoring — dev

This mirrors the prod pipeline:

- **Grafana Alloy** scrapes `/metrics`
- remote_writes to **Prometheus** at `http://10.10.10.18:9090`
- **Grafana** at `http://10.10.10.18:3000` serves the dashboards

Difference: dev runs its **own Alloy** inside the `rag-chatbot-dev` namespace.
Reason — the platform's `monitoring/alloy-config` belongs to another owner; adding a dev
scrape job to it could be lost on a platform upgrade, and a dev change could break prod
metrics.

## 1. What is deployed

`infra/k8s-dev/45-monitoring.yaml` provides:

- ServiceAccount + **namespaced** Role (pods/services/endpoints get/list/watch) — no
  permission to read secrets
- ConfigMap `alloy-dev-config` — scrapes dev backend pods every 15s
- Deployment `alloy` (replicas **1**, strategy Recreate)

The series carry these labels:

```
job="prometheus.scrape.chatbot_backend_dev"   # Alloy uses the component name as job
namespace="rag-chatbot-dev"
environment="dev"
pod="backend-…", app="backend"
```

`environment="dev"` keeps dev separate from prod series so a single dashboard can
switch on `environment`.

## 2. How to verify

```bash
# Is Alloy seeing the target (address must appear in the targets array)
kubectl -n rag-chatbot-dev port-forward deploy/alloy 12345:12345 &
curl -s localhost:12345/api/v0/web/components/prometheus.scrape.chatbot_backend_dev

# Did it reach Prometheus
curl -s --get http://10.10.10.18:9090/api/v1/query \
  --data-urlencode 'query=up{job="prometheus.scrape.chatbot_backend_dev"}'
# → value must be 1

# If scraping stopped
kubectl -n rag-chatbot-dev logs deploy/alloy --tail=50 | grep -iE 'error|fail'
```

## 3. Dashboard

Import `infra/monitoring/grafana-rag-chatbot-dev.json` into Grafana —
**Dashboards → New → Import → Upload JSON**, select Prometheus as the datasource.

Panels: backend up · chat requests/s by decision · p50/p95 latency · RAG stage p95 ·
confidence-gate decisions · guardrail events · process RSS · scrape duration · LLM tokens/s.

To write your own queries:

```promql
# request rate
sum by (decision) (rate(chat_requests_total{environment="dev"}[5m]))

# p95 latency
histogram_quantile(0.95,
  sum by (le) (rate(chat_latency_seconds_bucket{environment="dev"}[5m])))

# which stage is slow
histogram_quantile(0.95,
  sum by (stage, le) (rate(rag_stage_latency_seconds_bucket{environment="dev"}[5m])))

# did scraping stop
up{job="prometheus.scrape.chatbot_backend_dev"} == 0
```

## 4. Cautions

- **Do not raise replicas above 1** — if two collectors scrape the same target,
  timestamps get mixed and remote_write rejects them with "out of order sample"; the
  dashboard goes empty.
- `discovery.kubernetes` must include `namespaces { names = ["rag-chatbot-dev"] }` —
  listing cluster-wide with a namespaced Role returns 403 and leaves zero targets
  (it fails silently without raising an error).
- After every ConfigMap change, run `kubectl -n rag-chatbot-dev rollout restart deploy/alloy` —
  Alloy only reads config at start.
- Do not duplicate node/cAdvisor/KSM metrics in dev — they are cluster-wide, so the platform
  collector already collects them.
- `chat_*` metrics do not appear until there is traffic; a panel showing "No data" is normal.
