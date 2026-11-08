# M11 — Observability, Build & Deploy Crash Course (စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — Application တစ်ခုကို **production K8s** ထဲ တင်ရန်
> Docker → Harbor → K8s deployment pipeline နှင့် monitoring များကို မြန်မာလို သင်ကြားပါသည်။

---

## 📚 Lessons

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | Observability ၃ ရပ် — Metrics / Traces / Logs | 🟡 |
| **L2** | Prometheus Metrics (Counter/Histogram/Gauge) | 🟡 |
| **L3** | OpenTelemetry → LGTM Stack | 🟡 |
| **L4** | Docker Build + Harbor Registry | 🟡 |
| **L5** | K8s Deployment (digest-pinned rollout) | 🔴 |
| **L6** | Live Verification (never claim done locally) | 🔴 |

---

# Lesson 1 — Observability ၃ ရပ်

| Type | ဘာလဲ | ဥပမာ | Tool |
|---|---|---|---|
| **Metrics** | ဂဏန်းအချက်အလက် (time series) | `chat_requests_total = 150` | Prometheus |
| **Traces** | Request တစ်ခုရဲ့ path | login → chat → retrieve → LLM (각 မှာ ms) | Tempo |
| **Logs** | စာသား events | "user X asked Y, conf 0.82" | Loki |

**Grafana** က ၃ ခုလုံးရဲ့ dashboard — တစ်နေရာတည်းမှာ ကြည့်။

---

# Lesson 2 — Prometheus Metrics

```python
from prometheus_client import Counter, Histogram, Gauge

chat_requests_total = Counter("chat_requests_total", "Total chat requests")
chat_latency_seconds = Histogram("chat_latency_seconds", "Chat latency")
guardrail_events_total = Counter("guardrail_events_total", "Guardrail events",
                                  ["type"])      # injection / toxic / overflow
security_events_db_total = Gauge("security_events_db_total", "DB audit count")

# Usage
chat_requests_total.inc()
with chat_latency_seconds.time():
    run_pipeline(...)
guardrail_events_total.labels(type="injection").inc()
```

**Metric types:**
- **Counter** — တစ်ခါတစ်လေ တိုးမယ် (requests, errors)
- **Histogram** — distribution မှတ် (latency percentiles)
- **Gauge** — တိုးနိုင်/ကျနိုင် (active connections, DB count)

**⚠️ HPA churn gotcha** — pod restart တိုင်း Counter reset ဖြစ်သည်။
`increase()` က phantom counts ဖြစ်စေမယ် — **lifetime totals ကို DB gauge** အဖြစ်
တင်ပြီး `max()` ဖြင့် read ရမယ်။

## 🔧 Lab 11.2 — Grafana Dashboard Check

```bash
# Prometheus query ဥပမာများ:
sum(rate(chat_requests_total[5m]))                    # req/sec
histogram_quantile(0.95, rate(chat_latency_seconds_bucket[5m]))  # p95 latency
max(security_events_db_total)                          # lifetime total
```

---

# Lesson 3 — OpenTelemetry → LGTM

```
FastAPI (OTel SDK instrumented)
        │
        ├─ traces → OTLP → Alloy ──► Tempo      (service graph)
        ├─ metrics → OTLP ─────────► Mimir      (Prometheus query API)
        └─ logs ──────► Alloy ─────► Loki       (log search)

Grafana (UI) ← Tempo + Mimir + Loki data sources
```

## Code (best-effort — never raise)

```python
from app.observability.telemetry import setup_telemetry, start_quiet_span

setup_telemetry()   # lifespan ထဲ — ပျက်ရင် app မထ (best-effort)

# Request span
with start_quiet_span("chat.request", kind="SERVER") as span:
    span.set_attribute("chat.domain", "network")
    span.set_attribute("llm.model", "z-ai/glm-5.3-flash")
    # LLM stream
```

**Tempo service graph** — microservice များကြား ချိတ်ဆက်ပုံကို visualize လုပ်သည်။

---

# Lesson 4 — Docker Build + Harbor

```dockerfile
# backend/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen --no-dev
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Harbor** = on-prem Docker registry (`harbor.drlinuxer.com`) —
public images များ Docker Hub ထဲ မတင်ရ (enterprise policy)။

```bash
# Build + push
cd backend
docker build -t harbor.drlinuxer.com/rag-chatbot/backend:1.6.29 .
docker push harbor.drlinuxer.com/rag-chatbot/backend:1.6.29

# Desktop frontend လည်း အတူတူပါ
cd ../desktop
docker build -t harbor.drlinuxer.com/rag-chatbot/frontend:1.6.21 .
docker push ...
```

**Tag vs Digest:**
- `:1.6.29` — mutable tag (cache ပြဿနာ ဖြစ်နိုင်)
- `@sha256:51cb...` — **immutable digest** (exact build အတည်ပြု) — production မှာ ဒါကို သုံးပါ

---

# Lesson 5 — K8s Deployment (digest-pinned rollout)

```bash
unset KUBECONFIG

# ⚠️ Backend + celery-worker + celery-beat = SAME image (co-bump!)
BD=harbor.drlinuxer.com/rag-chatbot/backend:1.6.29@sha256:51cbc710...

kubectl -n rag-chatbot set image deploy/backend backend=$BD
kubectl -n rag-chatbot set image deploy/celery-worker celery-worker=$BD
kubectl -n rag-chatbot set image deploy/celery-beat celery-beat=$BD

# Frontend သီးသန့်
FD=harbor.drlinuxer.com/rag-chatbot/frontend:1.6.21@sha256:407536...
kubectl -n rag-chatbot set image deploy/frontend frontend=$FD

# Rollout စောင့်
kubectl -n rag-chatbot rollout status deploy/backend --timeout=400s
kubectl -n rag-chatbot rollout status deploy/frontend --timeout=300s
```

**Rollback လုပ်ပုံ:**
```bash
# previous digest မှတ်ထားပြီး ပြန် set
kubectl -n rag-chatbot set image deploy/backend backend=<old-digest>
```

## 🔧 Lab 11.1 — Digest-Pinned Rollout အားနည်းချက်စစ်

```bash
# 1. Current digest မှတ်
kubectl -n rag-chatbot get deploy backend \
  -o jsonpath='{.spec.template.spec.containers[0].image}'

# 2. Deploy new
kubectl -n rag-chatbot set image deploy/backend backend=<new-digest>

# 3. Rollout status + verify
kubectl -n rag-chatbot rollout status deploy/backend

# 4. Live health
curl -sk https://chat.drlinuxer.com/health -o /dev/null -w "%{http_code}\n"
```

---

# Lesson 6 — Live Verification ⭐ (Never claim done locally)

**ဒီ project ရဲ့ စည်းကမ်း** — local build အောင်မြင်မှု လုံးဝ မလုံလောက်ဘူး။
**Cluster ထဲ တက်ပြီးနောက်မှ** — စစ်ရမယ်။

```bash
# 1. Pods all Running?
kubectl -n rag-chatbot get pods

# 2. No restarts on new ReplicaSet?
kubectl -n rag-chatbot get pods -l app.kubernetes.io/name=backend

# 3. Health endpoint
curl -sk https://chat.drlinuxer.com/health
# → {"status": "ok"}

# 4. Live feature test (ဥပမာ — chat stream)
curl -sk -N -X POST https://chat.drlinuxer.com/api/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"test"}' | head -10

# 5. Errors in logs?
kubectl -n rag-chatbot logs deploy/backend --since=5m | grep -iE "error|warning"
```

---

# ✅ Self-Check (M11)

1. Metrics vs Traces vs Logs — ကွာပုံက ဘာလဲ? ဘယ်နေရာမှာ ဘယ်ဟာ သုံးလဲ?
2. Counter reset (HPA pod restart) — `increase()` ဘာလို့ လိမ်လဲ?
3. Digest-pinned image က tag-pinned ထက် ဘာလို့ ကောင်းလဲ?
4. Backend bump လုပ်တိုင်း celery-worker/beat ကို ဘာလို့ အတူ bump လုပ်ရလဲ?
5. "Never claim done locally" — local build test ပြီးလျှင် နောက် ဘာလုပ်ရမလဲ?

---

# 🎓 Final Capstone — End-to-End Trace

User က မေးခွန်းတစ်ခု မေးသည် — **အဆင့်တိုင်းကို စာရွက်ပေါ်မှာ ရေးပါ**:

```text
User login (LDAP) → JWT
  → POST /api/chat/stream (SSE)
    → guardrail.check (regex) — 5ms — file: security/guardrails.py
      metric: guardrail_events_total
    → classify.domain = "network"
      span: rag.domain
    → rewrite.query
    → hybrid retrieve → RRF → 8 docs
      span: rag.hybrid_search
    → rerank-svc HTTP → top score 0.98
      span: rag.cross_encoder_rerank
    → gate → 0.87 → decision=answer
    → prompt assembly (KB = DATA)
    → OpenRouter stream (fallback Ollama)
      span: chat.stream.llm
      metric: llm_tokens_total, chat_latency_seconds
    → SSE tokens → user sees answer
    → done {latency_ms, usage} → audit_log + DB persist
```

**မေးခွန်းများ** —
1. တစ်အဆင့်ချင်းမှာ ဘယ် file, ဘယ် span, ဘယ် metric ရှိလဲ?
2. ဘယ်အဆင့်မှာ fail ဖြစ်နိုင်လဲ? Degrade path ဘာလဲ?
3. Tempo trace ထဲ service graph ဘယ်လို ပြမလဲ?
4. Grafana dashboard ထဲ ဘယ် panel များ ပြမလဲ?

---

# 🏁 Course ပြီးစီးခြင်း — Next Steps

**အားလုံး ပြီးပြီလျှင်** —
1. `docs/course-project-guide.md` ထဲက **Verification Checklist ၇ ခု** ကို ကိုယ်တိုင် စမ်းပါ
2. `docs/course-workbook-tutorials-labs.md` ထဲက gotchas အားလုံး ပြန်သုံးသပ်ပါ
3. နောက်ဆုံး — **မင်းကိုယ်ပိုင် RAG project တစ်ခု စတင်တည်ဆောက်ပါ!**

**Theory မသိရင် hands-on မလုပ်နိုင်ဘူး၊ hands-on မလုပ်ရင် theory မမှတ်မိဘူး** —
နှစ်ခုစလုံး အတူတကွ လုပ်ပါ။ 🚀