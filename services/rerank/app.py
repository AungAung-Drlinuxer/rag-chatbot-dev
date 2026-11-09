"""rerank-svc — cross-encoder scoring over HTTP.

Contract (fixed by `backend/app/integrations/rerank_client.py`):

    POST /v1/rerank  {"query": str, "documents": [str, ...]}
                  -> {"results": [{"index": int, "relevance_score": float}, ...],
                      "took_ms": int}
    GET  /health     -> {"status": "ok", "model": str, "loaded": bool}

Design notes that matter in production:

* The model is loaded lazily on the first request, not at import. A pod that is
  still downloading/loading must not fail its startup probe for minutes.
* Scoring runs in a single worker with an internal lock: torch already saturates
  the CPU, and concurrent batches only make every request slower.
* `RERANK_MAX_BATCH` caps the work per call so a pathological request cannot keep
  the lock for minutes — the caller (backend) already sends at most ~50 docs.
"""
from __future__ import annotations

import logging
import os
import threading
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

logging.basicConfig(level=os.getenv("LOG_LEVEL", "info").upper(),
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("rerank-svc")

MODEL_NAME = os.getenv("RERANK_MODEL", "BAAI/bge-reranker-base")
DEVICE = os.getenv("RERANK_DEVICE", "cpu")
MAX_CANDIDATES = int(os.getenv("RERANK_MAX_CANDIDATES", "50"))
MAX_CHARS = int(os.getenv("RERANK_MAX_CHARS", "2000"))
API_KEY = os.getenv("RERANK_API_KEY", "").strip()

app = FastAPI(title="rerank-svc", docs_url=None, redoc_url=None, openapi_url=None)

_model = None
_model_lock = threading.Lock()
_predict_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from sentence_transformers import CrossEncoder

                started = time.time()
                logger.info("loading %s on %s", MODEL_NAME, DEVICE)
                _model = CrossEncoder(MODEL_NAME, device=DEVICE, max_length=512)
                logger.info("loaded in %.1fs", time.time() - started)
    return _model


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    documents: list[str]
    top_k: int | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "model": MODEL_NAME, "loaded": _model is not None}


@app.post("/v1/rerank")
def rerank(body: RerankRequest, x_api_key: str | None = Header(default=None)) -> dict:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")
    docs = body.documents[:MAX_CANDIDATES]
    if not docs:
        return {"results": [], "took_ms": 0}

    started = time.time()
    model = _get_model()
    pairs = [[body.query, (d or "")[:MAX_CHARS]] for d in docs]
    with _predict_lock:
        scores = model.predict(pairs, show_progress_bar=False, batch_size=8)

    results = sorted(
        ({"index": i, "relevance_score": float(s)} for i, s in enumerate(scores)),
        key=lambda r: r["relevance_score"],
        reverse=True,
    )
    if body.top_k:
        results = results[: body.top_k]
    took = int((time.time() - started) * 1000)
    logger.info("scored %d docs in %dms", len(docs), took)
    return {"results": results, "took_ms": took}
