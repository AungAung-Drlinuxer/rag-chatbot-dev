# M11 — Observability, Build & Deploy

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Observability ၃ ခု — Traces / Metrics / Logs

```
FastAPI (OTel SDK)     ─── traces ──► Alloy ──► Tempo    (service graph)
                       ─── metrics ──► Mimir            (Prometheus query)
                       ─── logs ────► Loki              (log search)
                Grafana dashboards (visualization layer)
```

**Custom metrics:**
```python
chat_requests_total        # Counter
chat_latency_seconds       # Histogram (p50/p95/p99)
guardrail_events_total     # Counter (injection/toxic/overflow)
security_events_db_total   # Gauge — DB audit_log မှ pull (max() ဖြင့်)
```

**⚠️ HPA churn lesson** — `increase()` က pod restart တိုင်း reset ဖြစ်သည် —
lifetime totals ကို DB မှ gauge အဖြစ်တင်ပြီး `max()` ဖြင့် read ရမည်။

### Build & Deploy Pipeline (digest-pinned rollout)

```bash
# Backend build → Harbor push → cluster deploy
cd backend
docker build -t harbor.drlinuxer.com/rag-chatbot/backend:1.6.19 .
docker push harbor.drlinuxer.com/rag-chatbot/backend:1.6.19

# ⚠️ Backend + celery-worker + celery-beat = SAME image (3 deployments co-bump)
kubectl -n rag-chatbot set image deploy/backend backend=<image>@sha256:<digest>
kubectl -n rag-chatbot set image deploy/celery-worker celery-worker=<same-digest>
kubectl -n rag-chatbot set image deploy/celery-beat celery-beat=<same-digest>

# Desktop
cd desktop && npm run build
docker build -t harbor.drlinuxer.com/rag-chatbot/frontend:1.6.19 .
docker push ...
kubectl -n rag-chatbot set image deploy/frontend frontend=<image>@sha256:<digest>

# LIVE verify (never claim done from local build!)
kubectl -n rag-chatbot rollout status deploy/backend
curl -sk https://chat.drlinuxer.com/health   # 200 OK
```

