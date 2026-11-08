# rag-chatbot-dev — cluster layout

Everything the dev workspace needs, and nothing else. Apply in filename order:

```bash
kubectl apply -f 05-config.yaml -f 20-database.yaml -f 40-redis.yaml \
  -f 41-ollama.yaml -f 42-rerank.yaml -f 43-celery.yaml \
  -f 30-backend.yaml -f 10-preview.yaml
```

| File | What it creates | Notes |
| --- | --- | --- |
| `05-config.yaml` | `backend-config` ConfigMap | the complete runtime config; all URLs point inside this namespace |
| `20-database.yaml` | CloudNativePG cluster `postgres-dev` | see `docs/database-setup.md` for the first-admin step |
| `40-redis.yaml` | Redis master + Sentinel + 3 Services | password from `backend-secrets`; Sentinel config templated at boot |
| `41-ollama.yaml` | Ollama (embedding runtime) | image ships `nomic-embed-text`; no PVC (a mount would hide the bundled models) |
| `42-rerank.yaml` | `rerank-svc` | CPU cross-encoder, `bge-reranker-base` |
| `43-celery.yaml` | `celery-worker`, `celery-beat` | same image as the backend; beat writes its schedule to `/tmp` |
| `30-backend.yaml` | FastAPI backend + Service | env from `backend-config` + `backend-secrets` |
| `10-preview.yaml` | frontend + Ingress | host `dev-chat.drlinuxer.com` only |

Deliberately absent (prod has them, dev does not need them): pgAdmin, RedisInsight, the 3-data +
3-sentinel topology, and the embedding-model PVC. Scaling Redis to prod's shape is a `replicas:`
change on the two StatefulSets plus `REDIS_SENTINELS` listing every sentinel.

## Where the secrets live

`backend-secrets` holds `DATABASE_URL`, `REDIS_PASSWORD`, `REDIS_URL`, `LDAP_BIND_PASSWORD`.
Provider keys, Confluence/Jira tokens and SMTP credentials are **not** in the cluster config —
they are stored in the database through Settings → Integrations and never returned by the API.
