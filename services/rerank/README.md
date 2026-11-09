# rerank-svc

Cross-encoder reranking over HTTP, CPU-only, model baked into the image.

```
POST /v1/rerank  {"query": "...", "documents": ["...", "..."]}
              -> {"results": [{"index": 2, "relevance_score": 0.87}, ...], "took_ms": 812}
GET  /health     -> {"status": "ok", "model": "BAAI/bge-reranker-base", "loaded": true}
```

The backend calls it from `app/integrations/rerank_client.py` when `RERANK_MODE=remote`
(the default in `infra/k8s-dev/05-config.yaml`). If it dies, the backend falls back to vector
order — chat keeps working, answers get worse, `rerank_failures_total` goes up.

## Why a separate service

The reranker saturates CPU for a few hundred milliseconds per query. Co-locating it with the
API made chat latency depend on rerank queue depth, so it moved out and scales on its own.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `RERANK_MODEL` | `BAAI/bge-reranker-base` | any sentence-transformers CrossEncoder |
| `RERANK_DEVICE` | `cpu` | `cuda` works with a GPU image |
| `RERANK_MAX_CANDIDATES` | `50` | hard cap per request |
| `RERANK_MAX_CHARS` | `2000` | truncation per document (the backend already sends 600) |
| `RERANK_API_KEY` | empty | when set, requests must send `X-API-Key` |

## Build and run

```bash
docker build -t <registry>/rerank-svc:1.0.2 .
docker run --rm -p 8080:8080 <registry>/rerank-svc:1.0.2

# local, against the backend venv (has torch + sentence-transformers)
uvicorn app:app --port 8080
```

The Dockerfile downloads the model at **build** time and then sets `HF_HUB_OFFLINE=1`, so a
pod never waits on huggingface.co. If you see `/health` return `loaded: false` for minutes,
the image was built without the bake step.

## Contract tests

```bash
curl -s localhost:8080/health
curl -s -X POST localhost:8080/v1/rerank -H 'Content-Type: application/json' \
  -d '{"query":"reset vpn password","documents":["vpn troubleshooting","pizza recipe"]}'
# expect the vpn document to score higher
```
