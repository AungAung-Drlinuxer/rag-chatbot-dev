## 🔧 Tutorial 11.1 — Digest-Pinned Rollout အားနည်းချက်စစ်

```bash
# 1. Rollout မစခင် current digest မှတ်
kubectl -n rag-chatbot get deploy backend -o jsonpath='{.spec.template.spec.containers[0].image}'

# 2. New image deploy
kubectl -n rag-chatbot set image deploy/backend backend=<new-digest>

# 3. Rollout စောင့်
kubectl -n rag-chatbot rollout status deploy/backend

# 4. Rollback လုပ်ချင်ရင် — old digest နဲ့ ပြန် set
```

**Beneath the hood** — `:1.6.19` tag နဲ့ ဆွဲရင် — Harbor က tag update လုပ်ပြီး
cache ပြဿနာ ဖြစ်နိုင်သည်။ **Digest pinning** — `@sha256:...` — exact build ကို အတည်ပြု။

## 🔧 Tutorial 11.2 — Grafana Dashboard Check

```bash
# Prometheus query (Grafana UI ထဲ)
sum(rate(chat_requests_total[5m]))          # request rate
histogram_quantile(0.95, rate(chat_latency_seconds_bucket[5m]))  # p95 latency

# ⚠️ Guardrail events — DB source-of-truth (HPA churn safe)
max(security_events_db_total)
```

