"""Phase 10 — LLM provider selection (anthropic | openai) tests (no network)."""
from app.llm import client as llm_mod
from app.config import SETTINGS


def test_make_chain_none_without_key(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "")
    assert llm_mod.make_chain() is None


def test_make_chain_openai_when_configured(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_provider", "openai")
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "test-key")
    monkeypatch.setattr(SETTINGS, "hchat_base_url", "https://openrouter.ai/api/v1")
    monkeypatch.setattr(SETTINGS, "hchat_model", "minimax/minimax-m3:free")
    chain = llm_mod.make_chain()
    assert chain is not None
    assert hasattr(chain, "stream")  # Runnable chain (LCEL prompt | llm | output_parser)


def test_make_chain_anthropic_when_configured(monkeypatch):
    monkeypatch.setattr(SETTINGS, "hchat_provider", "anthropic")
    monkeypatch.setattr(SETTINGS, "hchat_api_key", "test-key")
    chain = llm_mod.make_chain()
    assert chain is not None
    assert hasattr(chain, "stream")
