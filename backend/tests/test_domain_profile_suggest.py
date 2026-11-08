"""Domain profile suggestions, and the two warnings that were wrong.

The router classifies with an LLM from each domain's name and description; the keyword list is
the offline fallback. The board used to say "No keywords — this domain can never match", which
is untrue whenever the LLM path is live, and the admin was left to invent twenty words by hand.

These tests pin: the suggestion is grounded in the domain's own articles, junk keywords are
dropped, and an unavailable model is a clean refusal rather than an exception.
"""
from __future__ import annotations

from app.classifier import profile_suggest


class _FakeLLM:
    def __init__(self, reply: str):
        self.reply = reply
        self.prompts: list[str] = []

    def invoke(self, prompt: str):
        self.prompts.append(prompt)

        class _R:
            content = self.reply

        return _R()


def test_a_suggestion_is_grounded_in_this_domains_articles(monkeypatch):
    llm = _FakeLLM('{"description": "Printers, queues and consumables.", '
                   '"keywords": ["Printer", "paper jam", "printer", "", "toner"]}')
    monkeypatch.setattr("app.llm.client.make_llm", lambda: llm)

    out = profile_suggest.suggest_profile(
        key="printer", name="Printer", titles=["Printer jam on floor 3", "Toner replacement"])

    assert out is not None
    assert out["description"] == "Printers, queues and consumables."
    # lowercased, deduped, empties dropped
    assert out["keywords"] == ["printer", "paper jam", "toner"]
    prompt = llm.prompts[0]
    assert "Printer jam on floor 3" in prompt
    assert "printer" in prompt


def test_an_unparseable_reply_yields_nothing(monkeypatch):
    monkeypatch.setattr("app.llm.client.make_llm", lambda: _FakeLLM("I think it is about printers."))
    assert profile_suggest.suggest_profile(key="printer", name="Printer") is None


def test_a_missing_model_yields_nothing_instead_of_raising(monkeypatch):
    monkeypatch.setattr("app.llm.client.make_llm", lambda: None)
    assert profile_suggest.suggest_profile(key="printer", name="Printer") is None


def test_the_suggestion_prompt_forbids_generic_filler(monkeypatch):
    llm = _FakeLLM('{"description": "d", "keywords": ["x"]}')
    monkeypatch.setattr("app.llm.client.make_llm", lambda: llm)
    profile_suggest.suggest_profile(key="k", name="K")
    assert "No duplicates" in llm.prompts[0]
    assert "help" in llm.prompts[0]
