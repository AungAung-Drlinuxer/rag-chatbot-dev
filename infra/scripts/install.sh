#!/usr/bin/env bash
# One command from a bare cluster to a working install.
#
#   cp infra/env.example infra/env && $EDITOR infra/env     # domain, namespace, registry
#   infra/scripts/install.sh                                # everything, end to end
#
# What it adds on top of deploy.sh:
#   * installs the cluster prerequisites it needs (CloudNativePG, ingress-nginx) instead of
#     refusing to run when they are missing;
#   * fills in the values that are cluster-specific (StorageClass, IngressClass);
#   * creates every Secret with generated values, and the TLS secret if cert-manager can;
#   * creates the FIRST administrator and prints the password exactly once;
#   * verifies the result over HTTP (health + a real login), not just "pods are Running".
#
# Flags
#   --yes            do not prompt (for CI)
#   --skip-prereqs   never install operators, fail if they are missing
#   --no-smoke       skip the HTTP/login verification
#   --admin USER     first administrator's username (default: admin)
#
# Overrides: any value you export (DOMAIN, NAMESPACE, REGISTRY, STORAGE_CLASS,
# INGRESS_CLASS, TLS_ENABLED, BACKUP_ENABLED, MONITORING_ENABLED …) is written into
# infra/env before rendering, so this works from a pipeline with no file editing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/infra/env"
EXAMPLE="$ROOT/infra/env.example"

ASSUME_YES=0
SKIP_PREREQS=0
SMOKE=1
ADMIN_USER="${ADMIN_USER:-admin}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --skip-prereqs) SKIP_PREREQS=1 ;;
    --no-smoke) SMOKE=0 ;;
    --admin) ADMIN_USER="${2:?--admin needs a username}"; shift ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------------------------
# 0. tools
# --------------------------------------------------------------------------------------
for t in kubectl helm python3 openssl; do
  command -v "$t" >/dev/null || die "$t is required"
done

# --------------------------------------------------------------------------------------
# 1. infra/env — create it, then apply any exported overrides
# --------------------------------------------------------------------------------------
[[ -f "$ENV_FILE" ]] || { cp "$EXAMPLE" "$ENV_FILE"; note "created infra/env from the example"; }

# The caller's environment wins over the file. Capture it first: sourcing the file below
# would otherwise overwrite `NAMESPACE=rag-smoke install.sh` with the file's default and
# quietly deploy into the wrong namespace.
declare -A OVERRIDE=()
for key in NAMESPACE REGISTRY DOMAIN TLS_SECRET INGRESS_CLASS STORAGE_CLASS \
           POSTGRES_SIZE TLS_ENABLED BACKUP_ENABLED MONITORING_ENABLED \
           FRONTEND_TAG BACKEND_TAG OLLAMA_TAG RERANK_TAG; do
  [[ -n "${!key:-}" ]] && OVERRIDE[$key]="${!key}"
done

set -a; . "$ENV_FILE"; set +a

upsert() {  # upsert KEY VALUE into infra/env (no secrets ever go here)
  local key="$1" value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
import pathlib, re, sys
path, key, value = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
text = path.read_text()
line = f"{key}={value}"
if re.search(rf"^{re.escape(key)}=", text, flags=re.M):
    text = re.sub(rf"^{re.escape(key)}=.*$", line, text, flags=re.M)
else:
    text = text.rstrip("\n") + "\n" + line + "\n"
path.write_text(text)
PY
  export "$key=$value"
}

for key in "${!OVERRIDE[@]}"; do
  cur="$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  [[ "$cur" == "${OVERRIDE[$key]}" ]] || { upsert "$key" "${OVERRIDE[$key]}"; note "$key=${OVERRIDE[$key]}"; }
done

set -a; . "$ENV_FILE"; set +a
NAMESPACE="${NAMESPACE:?NAMESPACE is required in infra/env}"
DOMAIN="${DOMAIN:?DOMAIN is required in infra/env}"
REGISTRY="${REGISTRY:?REGISTRY is required in infra/env}"
TLS_ENABLED="${TLS_ENABLED:-1}"
INGRESS_CLASS="${INGRESS_CLASS:-}"
STORAGE_CLASS="${STORAGE_CLASS:-}"

say "target"
note "context:  $(kubectl config current-context)"
note "namespace: $NAMESPACE"
note "domain:    $DOMAIN"
kubectl version --request-timeout=10s >/dev/null || die "cannot reach the cluster"
if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "   install into $(kubectl config current-context)/$NAMESPACE? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]] || die "aborted"
fi

# --------------------------------------------------------------------------------------
# 2. cluster-specific values the manifests cannot know
# --------------------------------------------------------------------------------------
if [[ -z "$STORAGE_CLASS" ]]; then
  default_sc="$(kubectl get sc -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' 2>/dev/null | head -1)"
  [[ -n "$default_sc" ]] || default_sc="$(kubectl get sc -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -n "$default_sc" ]] || die "no StorageClass in this cluster — set STORAGE_CLASS (or enable one)"
  upsert STORAGE_CLASS "$default_sc"
  note "storage class: $default_sc (cluster default)"
fi

if [[ -z "$INGRESS_CLASS" ]]; then
  INGRESS_CLASS="$(kubectl get ingressclass -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  [[ -n "$INGRESS_CLASS" ]] || INGRESS_CLASS="nginx"
  upsert INGRESS_CLASS "$INGRESS_CLASS"
  note "ingress class: $INGRESS_CLASS"
fi

# --------------------------------------------------------------------------------------
# 3. prerequisites (installed only when missing)
# --------------------------------------------------------------------------------------
install_cnpg() {
  say "install CloudNativePG operator"
  helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
  helm repo update cnpg >/dev/null
  helm upgrade --install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace --wait
  kubectl wait --for=condition=Established --timeout=180s crd/clusters.postgresql.cnpg.io
}

install_ingress() {
  say "install ingress-nginx"
  helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx >/dev/null 2>&1 || true
  helm repo update ingress-nginx >/dev/null
  helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx \
    --create-namespace --set controller.ingressClassResource.name=nginx --wait
}

say "prerequisites"
need_cnpg=0
kubectl get crd clusters.postgresql.cnpg.io >/dev/null 2>&1 || need_cnpg=1
need_ingress=0
kubectl get ingressclass "$INGRESS_CLASS" >/dev/null 2>&1 || need_ingress=1

if [[ $need_cnpg -eq 1 ]]; then
  if [[ $SKIP_PREREQS -eq 1 ]]; then die "CloudNativePG CRD is missing and --skip-prereqs was given"; fi
  install_cnpg
else
  note "CloudNativePG: present"
fi

if [[ $need_ingress -eq 1 ]]; then
  if [[ $SKIP_PREREQS -eq 1 ]]; then die "IngressClass $INGRESS_CLASS is missing and --skip-prereqs was given"; fi
  install_ingress
  upsert INGRESS_CLASS "$INGRESS_CLASS"
else
  note "IngressClass $INGRESS_CLASS: present"
fi

say "namespace + secrets"
kubectl get ns "$NAMESPACE" >/dev/null 2>&1 || kubectl create ns "$NAMESPACE"
"$ROOT/infra/scripts/create-secrets.sh"

# Optional private-registry pull secret.
if [[ -n "${HARBOR_USER:-}" && -n "${HARBOR_PASSWORD:-}" ]]; then
  kubectl -n "$NAMESPACE" create secret docker-registry harbor-pull \
    --docker-server="${REGISTRY%%/*}" --docker-username="$HARBOR_USER" \
    --docker-password="$HARBOR_PASSWORD" --dry-run=client -o yaml | kubectl apply -f -
  note "pull secret harbor-pull created"
fi

if [[ "$TLS_ENABLED" == "1" ]] && ! kubectl -n "$NAMESPACE" get secret "${TLS_SECRET:-tls}" >/dev/null 2>&1; then
  note "no TLS secret '${TLS_SECRET:-tls}' yet — the Ingress will serve HTTP until it exists."
  note "set TLS_ENABLED=0 to render without the tls block, or create the secret first."
fi

# --------------------------------------------------------------------------------------
# 4. the stack itself
# --------------------------------------------------------------------------------------
say "render"
python3 "$ROOT/infra/scripts/render.py"

rendered_ns="$(grep -h "^  namespace:" "$ROOT"/infra/.rendered/*.yaml | awk '{print $2}' | sort -u | tr '\n' ' ')"
if [[ " $rendered_ns " != *" $NAMESPACE "* ]]; then
  die "rendered manifests target [$rendered_ns] but NAMESPACE=$NAMESPACE — refusing to apply"
fi
note "manifests target namespace: $NAMESPACE"

say "deploy"
"$ROOT/infra/scripts/deploy.sh" | sed 's/^/   /'

# Private registry: patch the workloads that pull our images.
if kubectl -n "$NAMESPACE" get secret harbor-pull >/dev/null 2>&1; then
  for d in backend frontend celery-worker celery-beat; do
    kubectl -n "$NAMESPACE" get deploy "$d" >/dev/null 2>&1 || continue
    kubectl -n "$NAMESPACE" patch deploy "$d" --type=merge \
      -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"harbor-pull"}]}}}}' >/dev/null
  done
  kubectl -n "$NAMESPACE" rollout status deploy/backend --timeout=300s >/dev/null
fi

# --------------------------------------------------------------------------------------
# 5. first administrator — password generated here, printed once, never stored in git
# --------------------------------------------------------------------------------------
say "first administrator"
if kubectl -n "$NAMESPACE" exec deploy/backend -- python -m app.bootstrap --check >/dev/null 2>&1; then
  : # schema is there; the admin step below reports whether one exists
fi

ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)"
ADMIN_DONE=0
kubectl -n "$NAMESPACE" delete pod bootstrap-admin --ignore-not-found >/dev/null 2>&1 || true
if printf '%s' "$ADMIN_PASSWORD" | kubectl -n "$NAMESPACE" run bootstrap-admin --rm -i --restart=Never \
     --image="${REGISTRY}/backend:${BACKEND_TAG}" --quiet \
     --overrides="{\"spec\":{\"containers\":[{\"name\":\"bootstrap-admin\",\"image\":\"${REGISTRY}/backend:${BACKEND_TAG}\",\"command\":[\"python\",\"-m\",\"app.bootstrap\"],\"args\":[\"--admin\",\"${ADMIN_USER}\"],\"stdin\":true,\"stdinOnce\":true,\"env\":[{\"name\":\"DATABASE_URL\",\"valueFrom\":{\"secretKeyRef\":{\"name\":\"backend-secrets\",\"key\":\"DATABASE_URL\"}}}]}]}}" \
     >/tmp/bootstrap-admin.log 2>&1; then
  ADMIN_DONE=1
  note "created or reset: $ADMIN_USER"
else
  note "could not create the admin automatically — see /tmp/bootstrap-admin.log"
  sed 's/^/     /' /tmp/bootstrap-admin.log | tail -5
fi

# --------------------------------------------------------------------------------------
# 6. verify over HTTP, not by looking at pods
# --------------------------------------------------------------------------------------
if [[ $SMOKE -eq 1 ]]; then
  say "verify"
  kubectl -n "$NAMESPACE" port-forward svc/backend 18080:8000 >/tmp/pf.log 2>&1 &
  PF_PID=$!
  trap 'kill $PF_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 30); do
    curl -sf http://127.0.0.1:18080/health >/dev/null 2>&1 && break
    sleep 1
  done
  health="$(curl -s -o /tmp/health.json -w '%{http_code}' http://127.0.0.1:18080/health || true)"
  note "/health -> $health $(head -c 120 /tmp/health.json 2>/dev/null)"
  [[ "$health" == "200" ]] || die "backend health check failed"

  code="$(curl -s -o /tmp/login.json -w '%{http_code}' -X POST http://127.0.0.1:18080/api/auth/login \
          -H 'Content-Type: application/json' \
          -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASSWORD\"}" || true)"
  if [[ "$code" == "200" ]]; then
    note "login as $ADMIN_USER -> 200"
  else
    note "login as $ADMIN_USER -> $code $(head -c 160 /tmp/login.json 2>/dev/null)"
    [[ $ADMIN_DONE -eq 1 ]] && note "(the account exists; check that the password reached the pod)"
  fi
  kill $PF_PID 2>/dev/null || true
  trap - EXIT

  ingress_ip="$(kubectl -n "$NAMESPACE" get ingress frontend -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
  [[ -n "$ingress_ip" ]] && note "ingress address: $ingress_ip — point $DOMAIN at it"
fi

say "done"
scheme="https"; [[ "$TLS_ENABLED" == "0" ]] && scheme="http"
echo "   URL:      $scheme://$DOMAIN/"
echo "   admin:    $ADMIN_USER"
if [[ $ADMIN_DONE -eq 1 ]]; then
  echo "   password: $ADMIN_PASSWORD      <-- shown once; change it after signing in"
else
  echo "   password: (not set — create one with: kubectl -n $NAMESPACE exec -it deploy/backend -- python -m app.bootstrap --admin $ADMIN_USER)"
fi
cat <<EOF

   Still to do in the UI (Settings):
     * Integrations -> LLM API: add the provider key, or pick the on-prem engine
     * Knowledge: sync the KB (empty KB = the assistant refuses every question)
     * Domains: add routing domains; re-classify once articles are in
EOF