"""Phase 1 MVP unit tests — no live Ollama / PG required for the pure-logic ones.

Integration (needs PG + Ollama) are marked and run with:  uv run pytest -m integration
"""
import pytest

from app.classifier.engine import classify_domain
from app.rag.gate import decide, similarity_to_confidence
from app.rag.rewriter import rewrite_query


def test_classifier_detects_database():
    domain, conf = classify_domain("Database connection is timing out")
    assert domain == "database"
    assert conf >= 0.7


def test_classifier_no_match_general():
    domain, conf = classify_domain("what is the weather")
    assert domain == "general"
    assert conf < 0.7


def test_gate_confidence_threshold():
    # below threshold -> caution (doc: score < 0.75 -> caution flag)
    assert decide(0.5) == "caution"
    assert decide(0.75) == "answer"


def test_similarity_to_confidence():
    assert similarity_to_confidence(0.3) == pytest.approx(0.7, abs=0.01)
    assert similarity_to_confidence(0.0) == 1.0


def test_rewriter_followup_borrows_last_turn():
    history = [{"role": "user", "content": "Database timeout troubleshooting steps"}]
    q = "what about that error?"
    out = rewrite_query(q, history)
    assert "Database" in out or "database" in out
