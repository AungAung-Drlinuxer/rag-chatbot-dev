# Deploying to a new cluster

Everything the app needs is in this repository: eleven manifests, four images, one script.
No state lives outside the namespace, so a new cluster is a clean install, not a migration.

---

## 1. What gets created

| Component | Image | Purpose | Needs |
| --- | --- | --- | --- |
| `postgres-dev` (CloudNativePG) | `ghcr.io/cloudnative-pg/postgresql:16.4` | knowledge, chat, audit, vectors | CNPG operator, 5Gi PVC |
| `redis-data` + `redis-sentinel` | `redis:7.4` | cache, Celery broker, rate limits | 2Gi PVC (master only) |
| `ollama` | `ollama:<tag>` | embeddings (`nomic-embed-text`, 768-dim) | 6Gi RAM limit, no PVC (model baked) |
| `rerank-svc` | `rerank-svc:<tag>` | cross-encoder rerank | 2 CPU / 2Gi |
| `backend` | `backend:<tag>` | FastAPI API + SSE chat | 0.5 CPU / 1.5Gi |
| `celery-worker` | `backend:<tag>` | Confluence sync, embeddings | 0.5 CPU / 1Gi |
| `celery-beat` | `backend:<tag>` | scheduled sync | small |
| `frontend` | `frontend:<tag>` | SPA + `/api` reverse proxy | 100m |
| `alloy` (optional) | `grafana/alloy:v1.0.0` | metrics to Prometheus | target URL |

Suggested floor: **4 vCPU / 12Gi** for the namespace. Everything except Ollama and the
reranker is small; those two hold models in memory.

## 2. Prerequisites

```bash
kubectl version                     # 1.27+
kubectl get storageclass            # at least one default class (or set STORAGE_CLASS)
kubectl get ingressclass            # nginx (or set INGRESS_CLASS)
kubectl get crd clusters.postgresql.cnpg.io   # CloudNativePG operator
```

CloudNativePG is not optional — the database is a `Cluster` CR. Install it once per cluster:

```bash
kubectl apply --server-side -f \
  https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.24/releases/cnpg-1.24.0.yaml
```

You also need:

- **DNS** — an A/CNAME record for `DOMAIN` pointing at the ingress.
- **TLS** — either cert-manager (`cert-manager.io/cluster-issuer` annotation) or a secret
  created by hand: `kubectl -n <ns> create secret tls <TLS_SECRET> --cert=… --key=…`
- **Registry** — push access to `REGISTRY`. If the cluster cannot reach it, pre-pull the
  images or use an internal mirror.

## 3. Configure

```bash
cp infra/env.example infra/env
$EDITOR infra/env
```

The six values that must change on a new cluster:

```ini
NAMESPACE=rag-chatbot
REGISTRY=registry.example.com/rag-chatbot
DOMAIN=chat.example.com
TLS_SECRET=chat-tls
INGRESS_CLASS=nginx
STORAGE_CLASS=            # empty = cluster default
```

`infra/env` also picks the image tags, the Postgres volume size, and whether backups and
monitoring are deployed. It is git-ignored: it is your cluster's identity, not the project's.

> Prefer `kubectl apply -f infra/k8s-dev/` directly? That still works — those files are the
> dev cluster's real values. `render.py` exists so nobody has to edit eleven files by hand.

## 4. Secrets

```bash
kubectl create namespace "$NAMESPACE"       # deploy.sh does this too
infra/scripts/create-secrets.sh
```

It generates and applies, printing nothing:

| Secret | Keys | Notes |
| --- | --- | --- |
| `backend-secrets` | `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `LDAP_BIND_PASSWORD`, `rerank-api-key` | the database password inside `DATABASE_URL` and in `postgres-dev-app` is generated once and shared |
| `postgres-dev-app` | `username`, `password` | CloudNativePG bootstrap role |
| `db-init-superuser` | `url` | optional; only for an **external** Postgres |

`LDAP_BIND_PASSWORD` starts empty on purpose — set it from Settings → Integrations (it is
stored in the database, write-only over the API).

## 5. Build and push images

```bash
infra/scripts/build-images.sh          # backend + frontend
infra/scripts/build-images.sh --all    # + rerank-svc + ollama (first install on a new cluster)
```

- `backend` — set `BAKE_RERANKER=0` (default) when you run `rerank-svc`, `1` if you run the
  reranker in-process (`RERANK_MODE=local`, +1.1GB image).
- `ollama` — bakes `nomic-embed-text` at build time. Build it where Docker has internet once;
  after that the cluster never downloads a model.
- `rerank-svc` — sources in `services/rerank/`, model baked the same way.

## 6. Deploy

```bash
infra/scripts/deploy.sh
```

Order, and why it is this order:

1. **namespace → config → database** — the ConfigMap is what every later pod mounts.
2. **wait for `postgres-dev`** — the operator needs ~1 minute; the schema job will fail if it
   starts earlier.
3. **`db-init` Job** — `python -m app.bootstrap --init`: pgvector, 31 tables, checkpoint
   tables, ownership, verification. Idempotent, so re-running is safe.
4. **redis, ollama, rerank, workers** — dependencies of chat.
5. **backend, frontend** — rolled out with `rollout status` waited on.
6. **backup, monitoring** — skipped when disabled in `infra/env`.

The script refuses to start if a secret, the CNPG CRD, the StorageClass or the IngressClass is
missing, instead of half-applying.

Manual equivalent:

```bash
python3 infra/scripts/render.py
kubectl apply -f infra/.rendered/00-namespace.yaml -f infra/.rendered/05-config.yaml
kubectl apply -f infra/.rendered/20-database.yaml
kubectl -n "$NAMESPACE" wait --for=condition=Ready cluster/postgres-dev --timeout=600s
kubectl apply -f infra/.rendered/15-db-init.yaml
kubectl apply -f infra/.rendered/40-redis.yaml -f infra/.rendered/41-ollama.yaml \
  -f infra/.rendered/42-rerank.yaml -f infra/.rendered/43-celery.yaml \
  -f infra/.rendered/30-backend.yaml -f infra/.rendered/10-preview.yaml
```

## 7. First administrator

Nothing is pre-created. Pick one:

```bash
# A) local credential (no directory yet)
kubectl -n "$NAMESPACE" exec deploy/backend -- python -m app.bootstrap --admin jane.doe

# B) directory account: add it to the admin group list in 05-config.yaml
#    RBAC_ADMIN_GROUPS (LDAP group) or DEV_ADMIN_USERNAMES=jane.doe, then restart the backend
kubectl -n "$NAMESPACE" rollout restart deploy/backend
```

## 8. Verify

```bash
kubectl -n "$NAMESPACE" get pods                 # all Running; db-init Completed
kubectl -n "$NAMESPACE" exec deploy/backend -- python -m app.bootstrap --check
curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/"     # 200
```

In the UI, in this order:

1. Sign in as the administrator.
2. **Settings → AI service** — provider + model + key, then *Test connection*.
3. **Settings → Integrations → Confluence** — URL, email, token → **Knowledge → Sync**.
4. **Overview** — the counters move only after real traffic; `—` means "no data", not "zero".
5. Ask a question the KB covers, and confirm the source links open Confluence.

## 9. Upgrade

```bash
# code already built and pushed as a new tag
sed -i "s/^BACKEND_TAG=.*/BACKEND_TAG=dev-1.0.60/" infra/env
python3 infra/scripts/render.py && kubectl apply -f infra/.rendered/30-backend.yaml
kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=300s
```

Schema changes are applied by the same `db-init` Job; run it if a release adds tables:

```bash
kubectl -n "$NAMESPACE" delete job db-init --ignore-not-found
kubectl apply -f infra/.rendered/15-db-init.yaml
kubectl -n "$NAMESPACE" wait --for=condition=complete job/db-init --timeout=600s
```

## 10. Rollback

```bash
kubectl -n "$NAMESPACE" set image deploy/backend  backend="$REGISTRY/backend:<previous>"
kubectl -n "$NAMESPACE" set image deploy/frontend frontend="$REGISTRY/frontend:<previous>"
kubectl -n "$NAMESPACE" set image deploy/celery-worker celery-worker="$REGISTRY/backend:<previous>"
kubectl -n "$NAMESPACE" set image deploy/celery-beat   celery-beat="$REGISTRY/backend:<previous>"
kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=300s
```

Rollback is image-only — the schema is additive, so an older backend still runs against a
newer database. Restoring data is a different operation: [OPERATIONS.md](OPERATIONS.md).

## 11. Air-gapped cluster

1. Build all four images on a machine with internet (§5), `docker save` them, transfer, load,
   push to the internal registry.
2. Set `REGISTRY` to that registry.
3. `BACKUP_ENABLED=0` and `MONITORING_ENABLED=0` unless you have an internal S3 and
   Prometheus.
4. The LLM provider must be reachable (or an internal gateway such as vLLM/OpenAI-compatible
   set in Settings → AI service). Embeddings and reranking are fully local.

## 12. When a pod does not start

| Pod | Symptom | Cause |
| --- | --- | --- |
| `postgres-dev-1` | `Pending` | no StorageClass / no PV — set `STORAGE_CLASS` |
| `db-init` | `CreateContainerConfigError` | `backend-secrets` missing |
| `db-init` | `permission denied to create extension "vector"` | an external Postgres whose user is not superuser |
| `backend` | `CrashLoopBackOff`, `database "assistant" does not exist` | `db-init` never completed |
| `backend` | `401` on every login | `JWT_SECRET` changed after users logged in (sessions invalidate), or LDAP not configured |
| `frontend` | page loads, `/api` 502 | backend Service not ready, or `nginx.conf` upstream port ≠ Service port |
| `ollama` | `model not found` | the image is stock `ollama/ollama`, not the baked one |
| `rerank-svc` | chat works, answers unsorted | image built without the model, or `RERANK_URL` wrong — check `/health` |
