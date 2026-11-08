"""HTTP client for the standalone rerank-svc (Option A split).

Cluster-internal only: the URL is an in-cluster Service DNS
(http://rerank-svc:8080) — no external egress, air-gap safe.

Contract (see rerank-svc/app.py):
    POST /v1/rerank {query, documents[], top_k} → {results[{index, relevance_score}]}

Raises on any transport/error problem; app.rerank catches and falls back to
vector order so a degraded reranker never takes chat down.
"""
from __future__ import annotations

import logging
import time

import httpx

from app.config import SETTINGS

logger = logging.getLogger("integrations.rerank")


def score(query: str, docs: list[dict]) -> list[float]:
    """Return a cross-encoder logit for every doc (same order as `docs`).

    `docs` items only need a "content" key; truncation mirrors the local path
    (first 2000 chars) so local and remote modes score identically.

    v1.6.42 — RETRY. This used to be a single POST with the full 30s timeout and
    no retry. rerank-svc is HPA-scaled, so a scale-up event routes traffic to a
    pod that is still loading bge-reranker; one ReadTimeout then dropped the whole
    request to vector order, the confidence gate scored it as `caution`, and the
    user was told "I couldn't find information in the knowledge base" even though
    the answer WAS indexed and retrievable. That turned a transient pod restart
    into a wrong answer.

    Now: a short per-attempt timeout (so a slow pod fails fast instead of blocking
    the request for 30s) with up to 3 attempts and backoff. The caller still
    catches everything, so a genuinely dead reranker degrades exactly as before.
    """
    payload = {
        "query": query,
        # v1.6.50 — MEASURED root cause of the rerank timeouts.
        #
        # The client used to send every fused candidate with up to 2000 chars each.
        # On the live KB that is 20 documents / 14.5k chars, and the service needed
        # 27.4s to score it — against a per-attempt timeout of 8s. So the rerank
        # stage failed EVERY time and silently fell back to vector order, which is
        # why four near-identical chunks of one article filled four of five slots.
        # A second sample hit 142s and the connection died outright.
        #
        # Cross-encoder relevance barely changes past the opening of a chunk, so
        # scoring 600 chars loses nothing while cutting the work ~3.3x per document.
        # Combined with the candidate cap in retrieval.py this takes a real batch
        # from ~27s to a few seconds.
        "documents": [(d.get("content") or "")[:600] for d in docs],
    }
    headers = {"Content-Type": "application/json"}
    if SETTINGS.rerank_api_key:
        headers["X-API-Key"] = SETTINGS.rerank_api_key
    url = SETTINGS.rerank_url.rstrip("/") + "/v1/rerank"

    # v1.6.50 — the per-attempt budget has to cover a LEGITIMATE slow batch, not
    # just a cold pod. 8s was treating real work as a failure. With the payload
    # now bounded, 12s is ample headroom while still failing fast on a dead pod.
    per_attempt = min(12.0, float(SETTINGS.rerank_timeout_s))
    attempts = 3
    last_exc: Exception | None = None

    for attempt in range(attempts):
        try:
            with httpx.Client(timeout=per_attempt) as client:
                r = client.post(url, json=payload, headers=headers)
                r.raise_for_status()
                body = r.json()
            scores = [0.0] * len(docs)
            for hit in body.get("results", []):
                idx = hit.get("index")
                if isinstance(idx, int) and 0 <= idx < len(docs):
                    scores[idx] = float(hit.get("relevance_score", 0.0))
            logger.debug("remote rerank: %d docs in %sms", len(docs), body.get("took_ms"))
            return scores
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < attempts - 1:
                # 0.4s, then 1.0s — long enough for a warming pod to answer.
                delay = 0.4 * (attempt + 1) + 0.3 * attempt
                logger.warning(
                    "rerank attempt %d/%d failed (%s: %s) — retrying in %.1fs",
                    attempt + 1, attempts, type(exc).__name__, exc, delay,
                )
                time.sleep(delay)

    logger.error("rerank failed after %d attempts: %s", attempts, last_exc)
    raise last_exc if last_exc else RuntimeError("rerank failed")
