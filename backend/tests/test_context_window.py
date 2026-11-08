"""Tests for context-window truncation and configurable retrieval top_k (Phase 10.1)."""
from app.config import SETTINGS
from app.rag.retrieval import build_context

# The module used to re-export build_context (`from app import rag`), which is why this
# test passed while calling rag.build_context. Import the real home so the test fails
# when the function moves, instead of raising AttributeError on a re-export.
rag = type("_RagShim", (), {"build_context": staticmethod(build_context)})()


def test_build_context_truncates_to_window(monkeypatch):
    """build_context should drop the tail of an oversized doc list and add a meta line."""
    monkeypatch.setattr(SETTINGS, "max_context_tokens", 100)         # tiny window
    monkeypatch.setattr(SETTINGS, "chars_per_token", 4)              # 400-char budget
    docs = [
        {"title": f"Doc {i}", "content": ("lorem ipsum " * 30), "domain": "system"}
        for i in range(8)
    ]
    out = rag.build_context(docs, "q?")
    assert out.startswith("Query: q?")
    # Must signal truncation at the tail
    assert "to fit context window" in out
    # Some docs kept, some dropped
    kept = [line for line in out.split("\n") if line.startswith("[")]
    assert 0 < len(kept) < len(docs)


def test_build_context_empty_docs_returns_header_only():
    out = rag.build_context([], "q?")
    assert out == "Query: q?\n"


def test_build_context_small_fits_all(monkeypatch):
    """Tiny inputs must NOT add a truncation meta line."""
    monkeypatch.setattr(SETTINGS, "max_context_tokens", 60000)
    monkeypatch.setattr(SETTINGS, "chars_per_token", 4)
    docs = [{"title": "A", "content": "short", "domain": "system"}]
    out = rag.build_context(docs, "q")
    assert "to fit context window" not in out
    assert "[1] A: short" in out
