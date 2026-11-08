"""Tests for the top_k override in RAGOrchestrationResult (Phase 10.1)."""
from app.orchestration import orchestrator as orchestration
from app.config import SETTINGS


def test_run_rag_uses_default_top_k(monkeypatch):
    """If top_k is None, fall back to SETTINGS.retrieval_top_k and echo it on the result."""
    monkeypatch.setattr(SETTINGS, "retrieval_top_k", 7)
    # Force the retriever to return [] (no real DB needed) and to NOT raise.
    monkeypatch.setattr(orchestration, "_retrieve", lambda q, d, k=None: [])
    res = orchestration.run_rag("hello")
    assert res.top_k == 7
    assert res.context_tokens_estimate >= 0


def test_run_rag_respects_top_k_override(monkeypatch):
    """Per-call top_k should override the global default."""
    monkeypatch.setattr(SETTINGS, "retrieval_top_k", 3)
    seen_k = {}

    def fake_retrieve(rewritten, domain, k=None):
        seen_k["k"] = k
        return []

    monkeypatch.setattr(orchestration, "_retrieve", fake_retrieve)
    res = orchestration.run_rag("hello", top_k=11)
    assert seen_k["k"] == 11
    assert res.top_k == 11
