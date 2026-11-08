"""Cross-encoder reranker — BAAI/bge-reranker-base on CPU (G6 v0.10.0).

Pipeline: vector search retrieves top-N (default 20) candidates cheaply,
then the cross-encoder scores each (query, chunk) pair for fine-grained
relevance, and only the top-K (default 5) survivors proceed to the LLM.

Config (SETTINGS):
- rerank_enabled (bool, default True)
- rerank_model (default "BAAI/bge-reranker-base")
- rerank_candidates (int, default 20)  # retrieve N before reranking
- rerank_device ("cpu" | "cuda", default "cpu")

The model is loaded lazily on first use and cached module-level; on CPU it
adds ~200-600ms for 20 candidates, acceptable for this workload.
"""
from __future__ import annotations

import logging
import threading

from app.config import SETTINGS

logger = logging.getLogger("rerank")

_lock = threading.Lock()
_model = None  # CrossEncoder singleton


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:  # double-checked
                from sentence_transformers import CrossEncoder

                logger.info("loading reranker %s on %s", SETTINGS.rerank_model, SETTINGS.rerank_device)
                _model = CrossEncoder(
                    SETTINGS.rerank_model,
                    device=SETTINGS.rerank_device,
                    max_length=512,
                )
    return _model


def _score(query: str, docs: list[dict]) -> list[float]:
    """Cross-encoder logits per doc — local singleton or remote rerank-svc.

    v0.22.x Option A: RERANK_MODE=remote delegates scoring to the standalone
    rerank-svc Deployment (model baked there). Transport/model errors bubble up
    and the caller's fallback (vector order) keeps chat alive.
    """
    if SETTINGS.rerank_mode == "remote":
        from app.integrations.rerank_client import score as remote_score

        return remote_score(query, docs)
    model = _get_model()
    pairs = [[query, d["content"][:2000]] for d in docs]
    return [float(s) for s in model.predict(pairs, show_progress_bar=False)]


def rerank(query: str, docs: list[dict], top_k: int | None = None) -> list[dict]:
    """Re-sort `docs` by cross-encoder relevance to `query`, keep top_k.

    Falls back to the original order (distance-sorted) on any failure so a
    broken reranker never takes retrieval down.
    """
    top_k = top_k or SETTINGS.retrieval_top_k
    if not SETTINGS.rerank_enabled or not docs:
        return docs[:top_k]
    try:
        scores = _score(query, docs)
        q_terms = {w for w in (query or "").lower().split() if len(w) > 2}
        # Generic single-word index/routing pages (e.g. "Network", "Server",
        # "Database") crowd out specific runbooks — slight penalty (v0.10.3).
        GENERIC_TITLES = {"network", "server", "database", "storage", "security",
                          "start here", "it support routing guide"}
        for doc, score in zip(docs, scores):
            s = float(score)
            title = (doc.get("title") or "").strip()
            title_terms = set(title.lower().replace("—", " ").split())
            overlap = sum(1 for t in q_terms if t in title_terms)
            boost = min(0.15 * overlap, 0.45)
            if title.lower() in GENERIC_TITLES:
                boost -= 0.1  # mild de-prioritization of index/hub pages
            doc["title_boost"] = round(boost, 3)
            doc["rerank_score"] = s
            doc["final_score"] = s + doc["title_boost"]
        ranked = sorted(docs, key=lambda d: d["final_score"], reverse=True)
        return ranked[:top_k]
    except Exception as exc:
        logger.warning("rerank failed (%s: %s) — falling back to vector order",
                       type(exc).__name__, exc)
        return sorted(docs, key=lambda d: d["distance"])[:top_k]
