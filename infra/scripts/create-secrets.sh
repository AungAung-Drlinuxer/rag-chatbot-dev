#!/usr/bin/env bash
# Create every Secret the stack needs, with strong random values.
#
#   infra/scripts/create-secrets.sh            # create what is missing
#   infra/scripts/create-secrets.sh --force    # rotate everything (breaks sessions)
#
# Nothing is printed: the values go straight into the cluster. Re-running without
# --force is safe and leaves existing secrets alone.
#
# Secrets created
#   backend-secrets      DATABASE_URL, REDIS_URL, REDIS_PASSWORD, JWT_SECRET,
#                        LDAP_BIND_PASSWORD (empty placeholder), rerank-api-key
#   postgres-dev-app     username/password for CloudNativePG bootstrap (must match
#                        the password inside DATABASE_URL)
#   db-init-superuser    optional superuser URL used by the db-init Job
#
# The TLS secret is NOT created here — use cert-manager, or:
#   kubectl -n "$NAMESPACE" create secret tls "$TLS_SECRET" --cert=fullchain.pem --key=privkey.pem
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/infra/env"
[[ -f "$ENV_FILE" ]] && set -a && . "$ENV_FILE" && set +a

NAMESPACE="${NAMESPACE:-rag-chatbot-dev}"
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

say() { printf '  %s\n' "$*"; }
exists() { kubectl -n "$NAMESPACE" get secret "$1" >/dev/null 2>&1; }

rand_pw() { openssl rand -hex 24; }
rand_key() { openssl rand -hex 32; }

echo "namespace: $NAMESPACE"
kubectl get ns "$NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$NAMESPACE"

if exists backend-secrets && [[ $FORCE -eq 0 ]]; then
  say "backend-secrets exists — skipping (use --force to rotate)"
  DB_PW="$(kubectl -n "$NAMESPACE" get secret postgres-dev-app -o jsonpath='{.data.password}' 2>/dev/null | base64 -d || true)"
else
  DB_PW="$(rand_pw)"
  REDIS_PW="$(rand_pw)"
  JWT_SECRET="$(rand_key)"

  kubectl -n "$NAMESPACE" create secret generic backend-secrets \
    --from-literal=DATABASE_URL="postgresql+psycopg2://app:${DB_PW}@postgres-dev-rw:5432/assistant" \
    --from-literal=REDIS_URL="redis://:${REDIS_PW}@redis-master:6379/0" \
    --from-literal=REDIS_PASSWORD="${REDIS_PW}" \
    --from-literal=JWT_SECRET="${JWT_SECRET}" \
    --from-literal=LDAP_BIND_PASSWORD="" \
    --from-literal=rerank-api-key="$(rand_key)" \
    --dry-run=client -o yaml | kubectl -n "$NAMESPACE" apply -f -
  say "backend-secrets created (database, redis, jwt, rerank key)"
fi

if exists postgres-dev-app && [[ $FORCE -eq 0 ]]; then
  say "postgres-dev-app exists — skipping"
else
  [[ -z "${DB_PW:-}" ]] && DB_PW="$(rand_pw)"
  kubectl -n "$NAMESPACE" create secret generic postgres-dev-app \
    --from-literal=username=app \
    --from-literal=password="${DB_PW}" \
    --dry-run=client -o yaml | kubectl -n "$NAMESPACE" apply -f -
  say "postgres-dev-app created (CNPG bootstrap role)"
fi

# Optional: lets db-init create the role/database on a cluster where they do not exist.
# CNPG already does that from postgres-dev-app, so this is only needed for external
# PostgreSQL installations.
if exists db-init-superuser || [[ -n "${SUPERUSER_URL:-}" ]]; then
  say "db-init-superuser: present or provided via SUPERUSER_URL"
else
  say "db-init-superuser: not created (fine for the bundled CNPG cluster)"
fi

echo
echo "done. Nothing was printed on purpose — read values with:"
echo "  kubectl -n $NAMESPACE get secret backend-secrets -o jsonpath='{.data.JWT_SECRET}' | base64 -d"
