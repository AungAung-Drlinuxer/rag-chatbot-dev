#!/usr/bin/env bash
# Bring the whole stack up on a cluster, from nothing.
#
#   cp infra/env.example infra/env && $EDITOR infra/env
#   infra/scripts/create-secrets.sh
#   infra/scripts/build-images.sh
#   infra/scripts/deploy.sh
#
# Idempotent: every step can be re-run. It refuses to start when a prerequisite is
# missing instead of failing halfway through the apply.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$ROOT/infra/env" ]] || { echo "missing infra/env — copy infra/env.example"; exit 1; }
set -a; . "$ROOT/infra/env"; set +a

NAMESPACE="${NAMESPACE:?}"
OUT="$ROOT/infra/.rendered"

say() { printf '\n== %s\n' "$*"; }

say "preflight"
kubectl version --request-timeout=10s >/dev/null
kubectl get ns "$NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$NAMESPACE"
kubectl -n "$NAMESPACE" get secret backend-secrets >/dev/null \
  || { echo "backend-secrets is missing — run infra/scripts/create-secrets.sh"; exit 1; }
kubectl get crd clusters.postgresql.cnpg.io >/dev/null \
  || { echo "CloudNativePG operator is not installed (clusters.postgresql.cnpg.io)"; exit 1; }
if [[ -n "${STORAGE_CLASS:-}" ]]; then
  kubectl get storageclass "$STORAGE_CLASS" >/dev/null \
    || { echo "StorageClass $STORAGE_CLASS does not exist"; exit 1; }
fi
kubectl get ingressclass "$INGRESS_CLASS" >/dev/null \
  || { echo "IngressClass $INGRESS_CLASS does not exist"; exit 1; }
kubectl -n "$NAMESPACE" get secret postgres-dev-app >/dev/null \
  || { echo "postgres-dev-app is missing — run infra/scripts/create-secrets.sh"; exit 1; }
echo "  ok: namespace, secrets, CNPG, storage, ingress"

say "render manifests"
python3 "$ROOT/infra/scripts/render.py"

say "config + database"
kubectl apply -f "$OUT/00-namespace.yaml" -f "$OUT/05-config.yaml"
kubectl apply -f "$OUT/20-database.yaml"
kubectl -n "$NAMESPACE" wait --for=condition=Ready --timeout=600s \
  clusters.postgresql.cnpg.io/postgres-dev || { echo "postgres cluster did not become ready"; exit 1; }

say "schema (db-init Job)"
kubectl -n "$NAMESPACE" delete job db-init --ignore-not-found
kubectl apply -f "$OUT/15-db-init.yaml"
kubectl -n "$NAMESPACE" wait --for=condition=complete --timeout=600s job/db-init \
  || { kubectl -n "$NAMESPACE" logs job/db-init --tail=50; exit 1; }

say "redis, ollama, reranker, workers"
kubectl apply -f "$OUT/40-redis.yaml" -f "$OUT/41-ollama.yaml" -f "$OUT/42-rerank.yaml" -f "$OUT/43-celery.yaml"

say "backend + frontend"
kubectl apply -f "$OUT/30-backend.yaml" -f "$OUT/10-preview.yaml"
for d in backend frontend; do
  kubectl -n "$NAMESPACE" rollout status "deploy/$d" --timeout=600s
done

if [[ -f "$OUT/21-backup.yaml" ]]; then
  say "backups"
  kubectl apply -f "$OUT/21-backup.yaml" || echo "  (skipped: S3 credentials/plugin not configured)"
fi
if [[ -f "$OUT/45-monitoring.yaml" ]]; then
  say "monitoring"
  kubectl apply -f "$OUT/45-monitoring.yaml" || echo "  (skipped: no Prometheus target)"
fi

say "verify"
kubectl -n "$NAMESPACE" get pods
code="$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/" || true)"
echo "  https://$DOMAIN/ -> ${code:-no-answer}"
echo
echo "Next: open https://$DOMAIN/ and sign in. The first admin is whichever account you"
echo "list in RBAC_ADMIN_GROUPS (or DEV_ADMIN_USERNAMES) in $OUT/05-config.yaml."
