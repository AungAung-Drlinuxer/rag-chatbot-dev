#!/usr/bin/env bash
# Build and push every image the stack needs.
#
#   infra/scripts/build-images.sh                # backend + frontend
#   infra/scripts/build-images.sh --all          # + rerank-svc + ollama (slow, ~4GB)
#   infra/scripts/build-images.sh --backend      # one at a time
#
# Backend note: BAKE_RERANKER=0 is the default because this stack runs the standalone
# rerank-svc. Pass BAKE_RERANKER=1 if you deploy with RERANK_MODE=local and no
# rerank-svc — the backend image then carries the model (~1.1GB more).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ -f "$ROOT/infra/env" ]] && set -a && . "$ROOT/infra/env" && set +a

REGISTRY="${REGISTRY:?set REGISTRY in infra/env}"
BACKEND_TAG="${BACKEND_TAG:-latest}"
FRONTEND_TAG="${FRONTEND_TAG:-latest}"
OLLAMA_TAG="${OLLAMA_TAG:-0.5.7-models}"
RERANK_TAG="${RERANK_TAG:-1.0.2}"
BAKE_RERANKER="${BAKE_RERANKER:-0}"

build() { # name context image extra-args...
  local name="$1" ctx="$2" image="$3"; shift 3
  echo "==> $name -> $image"
  docker build "$@" -t "$image" "$ctx"
  docker push "$image"
}

case "${1:-all}" in
  --all)        MODE=all ;;
  --backend)    MODE=backend ;;
  --frontend)   MODE=frontend ;;
  *)            MODE=default ;;
esac

if [[ "$MODE" == "backend" || "$MODE" == "all" || "$MODE" == "default" ]]; then
  build backend "$ROOT/backend" "$REGISTRY/backend:$BACKEND_TAG" \
        --build-arg "BAKE_RERANKER=$BAKE_RERANKER"
fi
if [[ "$MODE" == "frontend" || "$MODE" == "all" || "$MODE" == "default" ]]; then
  build frontend "$ROOT/frontend" "$REGISTRY/frontend:$FRONTEND_TAG"
fi
if [[ "$MODE" == "all" ]]; then
  build rerank-svc "$ROOT/services/rerank" "$REGISTRY/rerank-svc:$RERANK_TAG"
  build ollama "$ROOT/infra/images/ollama" "$REGISTRY/ollama:$OLLAMA_TAG"
fi

echo "done."
