"""Context-window truncation for the retrieval prompt.

The context block is now fenced and labelled ("=== KNOWLEDGE BASE CONTEXT (DATA ONLY …)"),
so these assertions read the current shape: a boundary line, the question, numbered
article blocks, and the truncation notice at the tail.
"""
import app.runtime as runtime

from app.config import SETTINGS
from app.rag.retrieval import build_context


def test_build_context_truncates_to_window(monkeypatch):
    """build_context should drop the tail of an oversized doc list and add a meta line."""
    # The window is a runtime knob (admin-editable), not a SETTINGS field any more.
    # 200 tokens x 4 chars = 800 chars: room for one article block, not for eight.
    monkeypatch.setattr(runtime, "get", lambda key, *a: 200 if key == "max_context_tokens" else 0)
    monkeypatch.setattr(SETTINGS, "chars_per_token", 4)              # 400-char budget
    docs = [
        {"title": f"Doc {i}", "content": ("lorem ipsum " * 30), "domain": "system"}
        for i in range(8)
    ]
    out = build_context(docs, "q?")
    assert out.startswith("=== KNOWLEDGE BASE CONTEXT")
    assert "User question: q?" in out
    assert out.rstrip().endswith("=== END CONTEXT ===")
    # Must signal truncation at the tail
    assert "to fit context window" in out
    # Some docs kept, some dropped
    kept = [line for line in out.split("\n") if line.startswith("--- KB Article [")]
    assert 0 < len(kept) < len(docs)


def test_build_context_empty_docs_returns_header_only():
    out = build_context([], "q?")
    assert out.startswith("=== KNOWLEDGE BASE CONTEXT")
    assert "User question: q?" in out
    assert "--- KB Article [" not in out
    assert out.rstrip().endswith("=== END CONTEXT ===")


def test_build_context_small_fits_all(monkeypatch):
    """Tiny inputs must NOT add a truncation meta line."""
    monkeypatch.setattr(runtime, "get", lambda key, *a: 60000 if key == "max_context_tokens" else 0)
    monkeypatch.setattr(SETTINGS, "chars_per_token", 4)
    docs = [{"title": "A", "content": "short", "domain": "system"}]
    out = build_context(docs, "q")
    assert "to fit context window" not in out
    assert "--- KB Article [1] ---" in out
    assert "Title: A" in out
    assert "short" in out
