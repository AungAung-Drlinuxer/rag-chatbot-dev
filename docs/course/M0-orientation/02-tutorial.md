## 🔧 Tutorial 1.1 — Cluster ကြည့်ခြင်း (Live Lab)

```bash
# သင့် cluster ထဲရှိ pods အားလုံး ကြည့်မယ်
unset KUBECONFIG
kubectl -n rag-chatbot get pods

# တစ်ခုချင်းစီ ဘယ် node ပေါ်မှာ run နေလဲ ကြည့်
kubectl -n rag-chatbot get pods -o wide

# Service များ ကြည့်
kubectl -n rag-chatbot get svc

# Backend container ထဲ ဝင်ပြီး Python package list ကြည့်
kubectl -n rag-chatbot exec deploy/backend -- pip list | head -20
```

**ကျွန်တော်တို့ cluster ထဲရှိ pods ၂၀ ခန့်:**
- `backend-...` — FastAPI x2 (HPA lock 2-2)
- `celery-worker` + `celery-beat` — KB sync
- `postgres-ha-1/2` — CNPG HA (1 primary + 1 replica)
- `postgres-ha-pooler-...` — PgBouncer
- `redis-data-0/1/2` + `redis-sentinel-0/1/2` — Redis HA
- `ollama-...` — `llama3.2:1b` + `nomic-embed-text`
- `rerank-svc-...` — `bge-reranker-base`
- `frontend-...` — nginx serve static
- `pgadmin`, `redisinsight` — admin tools

