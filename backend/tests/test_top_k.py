"""top_k: the per-call override, and the admin-tunable default.

The default is no longer read from SETTINGS — the runtime registry (system_settings,
editable from the admin RAG panel) is the source of truth, so a test that monkeypatched
SETTINGS was asserting against a value the orchestrator had stopped consulting.
"""
import app.runtime as runtime

from app.orchestration import orchestrator as orchestration


def test_run_rag_uses_the_runtime_default_top_k(monkeypatch):
    """If top_k is None, fall back to the runtime knob and echo it on the result."""
    monkeypatch.setattr(runtime, "get", lambda key, *a: 7 if key == "retrieval_top_k" else 0)
    # Force the retriever to return [] (no real DB needed) and to NOT raise.
    monkeypatch.setattr(orchestration, "_retrieve", lambda q, d, k=None: [])
    res = orchestration.run_rag("hello")
    assert res.top_k == 7
    assert res.context_tokens_estimate >= 0


def test_run_rag_respects_top_k_override(monkeypatch):
    """Per-call top_k should override the global default."""
    monkeypatch.setattr(runtime, "get", lambda key, *a: 3 if key == "retrieval_top_k" else 0)
    seen_k = {}

    def fake_retrieve(rewritten, domain, k=None):
        seen_k["k"] = k
        return []

    monkeypatch.setattr(orchestration, "_retrieve", fake_retrieve)
    res = orchestration.run_rag("hello", top_k=11)
    assert seen_k["k"] == 11
    assert res.top_k == 11
