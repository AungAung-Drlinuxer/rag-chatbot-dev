# Kubernetes manifests

Twelve files, one namespace, no external state. The numbers are the apply order.

| File | Creates | Notes |
| --- | --- | --- |
| `00-namespace.yaml` | `Namespace` | label `app.kubernetes.io/part-of` |
| `05-config.yaml` | `ConfigMap backend-config` | every URL, model name and pipeline knob |
| `10-preview.yaml` | frontend Deployment + Service + Ingress | nginx on :8080 behind Service :80; SSE-safe annotations |
| `15-db-init.yaml` | Job `db-init` | `python -m app.bootstrap --init`, idempotent |
| `20-database.yaml` | CNPG `Cluster postgres-dev` | pgvector via `postInitApplicationSQL`; 5Gi |
| `21-backup.yaml` | `ObjectStore` + nightly `ScheduledBackup` | needs the barman-cloud plugin + S3 secret |
| `30-backend.yaml` | backend Deployment + Service | uid 10001, non-root, read-only root filesystem |
| `40-redis.yaml` | Redis master + Sentinel StatefulSets | master PVC on `STORAGE_CLASS` |
| `41-ollama.yaml` | Ollama Deployment + Service | image has `nomic-embed-text` baked in |
| `42-rerank.yaml` | rerank-svc Deployment + Service | CPU cross-encoder, model baked in |
| `43-celery.yaml` | celery-worker + celery-beat | same image as backend |
| `45-monitoring.yaml` | Alloy ServiceAccount/Role/ConfigMap/Deployment | remote-write to Prometheus |

## Do not apply these by hand on a new cluster

They carry *this* cluster's names: `harbor.drlinuxer.com/rag-chatbot-dev`,
`dev-chat.drlinuxer.com`, `truenas-iscsi`. Use the scripts:

```bash
cp infra/env.example infra/env && $EDITOR infra/env   # namespace, registry, domain, tags
infra/scripts/create-secrets.sh                       # secrets (never committed)
infra/scripts/build-images.sh                         # images
infra/scripts/deploy.sh                               # render + apply + verify
```

`infra/scripts/render.py` writes `infra/.rendered/` with your values substituted; that is
what `deploy.sh` applies. Applying `infra/k8s-dev/` directly is still valid — it is what this
repo's own dev cluster runs.

## Secrets

| Secret | Keys | Created by |
| --- | --- | --- |
| `backend-secrets` | `DATABASE_URL`, `REDIS_URL`, `REDIS_PASSWORD`, `JWT_SECRET`, `LDAP_BIND_PASSWORD`, `rerank-api-key` | `create-secrets.sh` |
| `postgres-dev-app` | `username`, `password` | `create-secrets.sh` (CNPG bootstrap) |
| `db-init-superuser` | `url` | optional, external Postgres only |
| `<TLS_SECRET>` | `tls.crt`, `tls.key` | cert-manager or `kubectl create secret tls` |
| `cnpg-backup-s3` | `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `REGION` | you, if backups are enabled |

Provider keys, Confluence/Jira tokens and SMTP credentials are **not** here: they live in the
database, written through Settings → Integrations, and are never returned by the API.

## What is deliberately absent

Prod-only pieces that a dev or small install does not need: pgAdmin, RedisInsight, the
3-data + 3-sentinel Redis topology, and the embedding-model PVC. Scaling Redis to that shape
is a `replicas:` change plus a `REDIS_SENTINELS` list.

## Dependency order

```
namespace → config → postgres (wait Ready) → db-init (wait Complete)
        → redis / ollama / rerank / celery → backend → frontend
        → backup, monitoring
```

`deploy.sh` enforces exactly this and refuses to start when a secret, the CNPG CRD, the
StorageClass or the IngressClass is missing.
