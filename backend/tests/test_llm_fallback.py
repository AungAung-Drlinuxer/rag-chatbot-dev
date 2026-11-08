"""LLM fault tolerance: an outage degrades to an honest notice, never a fabricated answer.

The previous version of this file asserted the opposite — that a canned "dev mock" string
came back when the provider was missing — which is how a stub answer could reach a user as
if it were knowledge-base output. These tests pin the current contract:

* streaming never raises, whatever the provider does;
* when nothing can generate, the text says the model is not configured;
* no placeholder content is ever emitted.
"""
from app.config import SETTINGS
from app.llm import client as llm_mod

NOTICE = "No AI model is configured"


def _collect(stream) -> str:
    return "".join(tok for tok, _usage in stream)


def test_primary_failure_degrades_to_a_notice(monkeypatch):
    class _Down:
        def stream(self, *a, **k):
            raise RuntimeError("provider down")

    monkeypatch.setattr(SETTINGS, "hchat_api_key", "test-key")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    monkeypatch.setattr(llm_mod, "make_llm", lambda: _Down())

    out = _collect(llm_mod.stream_answer("q", "ctx"))

    assert NOTICE in out, out
    assert "mock" not in out.lower()


def test_no_provider_configured_says_so(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", False)
    monkeypatch.setattr(llm_mod, "make_llm", lambda: None)

    out = _collect(llm_mod.stream_answer("q", "ctx"))

    assert NOTICE in out, out
    assert "sample" not in out.lower()


def test_unreachable_local_fallback_still_returns_a_notice(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    monkeypatch.setattr(SETTINGS, "fallback_enabled", True)
    monkeypatch.setattr(SETTINGS, "ollama_url", "http://127.0.0.1:1")
    monkeypatch.setattr(llm_mod, "make_llm", lambda: None)

    out = _collect(llm_mod.stream_answer("q", "ctx"))

    assert NOTICE in out, out
    assert "lorem" not in out.lower()
