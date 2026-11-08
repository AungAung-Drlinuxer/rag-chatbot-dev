"""Confidence gate — decide answer vs caution based on retrieval confidence.

Design doc §3 ④:  Score ≥ 0.75 → LLM answers directly (cites KB). Score < 0.75 →
LLM answers but flags a caution message + makes the escalate button prominent.
(Not a split pipeline — a single flow with a confidence-tempered tone, per doc.)
"""
from __future__ import annotations

DECISION_ANSWER = "answer"
DECISION_CAUTION = "caution"


def similarity_to_confidence(distance: float) -> float:
    """PGVector returns a cosine *distance* (lower = closer); map to a 0..1 confidence."""
    sim = 1.0 - distance
    return round(max(0.0, min(sim, 1.0)), 3)


def gate_confidence(doc: dict) -> float:
    """Confidence for the top doc — rerank-aware (v0.10.3).

    When the cross-encoder scored the doc, its normalized sigmoid score is a
    much better relevance signal than raw cosine distance (which reflects the
    vector-hybrid fusion, not true query-document fit).
    """
    rr = doc.get("rerank_score")
    if rr is not None:
        import math

        # v1.6.26 — bge-reranker-base emits logits in a narrow ~0..1 range for
        # relevant pairs (sigmoid(rr) saturates at ~0.73), which made the 0.75
        # gate nearly unreachable even for exact title matches (conf 0.732 on a
        # 74%-match article). Apply a 2.5x gain: relevant pairs (~1.0 logit) map
        # to ~0.92, irrelevant (~0.0 logit) stay ~0.5 — real separation again.
        sig = 1.0 / (1.0 + math.exp(-2.5 * rr))
        blend = 0.7 * sig + 0.3 * similarity_to_confidence(doc.get("distance", 1.0))
        return round(max(0.0, min(blend, 1.0)), 3)
    return similarity_to_confidence(doc.get("distance", 1.0))


def decide(confidence: float) -> str:
    """Above/equal threshold → answer directly; below → caution flag.

    Threshold is read at request time so admin overrides in the Settings UI
    take effect immediately (no restart).
    """
    from app.runtime import get as runtime_get
    threshold = runtime_get("confidence_gate_threshold")
    return DECISION_ANSWER if confidence >= threshold else DECISION_CAUTION


def caution_message() -> str:
    return "No specific guide found — please verify these steps before proceeding."
