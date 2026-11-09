"""Drafting rules: relevance, redaction, and "do not invent"."""
from __future__ import annotations

from app.escalation import draft as D

CONVERSATION = [
    {"role": "user", "content": "hi, how are you"},
    {"role": "assistant", "content": "I'm well — how can I help with IT today?"},
    {"role": "user", "content": "my VPN keeps dropping every ten minutes"},
    {"role": "assistant", "content": "Try restarting the VPN client and check the logs."},
    {"role": "user", "content": "I restarted it, still dropping. Error 619 appears."},
    {"role": "assistant", "content": "Error 619 usually means the port is blocked."},
]


def test_relevant_messages_skip_the_small_talk() -> None:
    picked = D.select_relevant(CONVERSATION)
    texts = [m["content"] for m in picked]
    assert any("VPN keeps dropping" in t for t in texts)
    assert any("Error 619" in t for t in texts)
    assert not any("how are you" in t for t in texts)


def test_relevance_always_includes_the_last_question_and_its_answer() -> None:
    picked = D.select_relevant(CONVERSATION)
    assert picked[-1]["content"].startswith("Error 619 usually") or \
        picked[-1]["content"].startswith("I restarted")
    assert any("Error 619" in m["content"] for m in picked)


def test_empty_conversation_is_not_an_error() -> None:
    assert D.select_relevant([]) == []


def test_redaction_removes_secrets_and_emails() -> None:
    text = ("key sk-test-REDACTED-fixture card 4111 1111 1111 1111 "
            "mail me at aung@example.com")
    out = D.redact(text)
    assert "sk_test" not in out
    assert "4111 1111" not in out
    assert "aung@example.com" not in out
    assert out.count("[REDACTED:") >= 3


def test_normalise_drops_unknown_keys_and_strings_for_lists() -> None:
    out = D.normalise({"summary": "VPN drops", "symptoms": "drops every 10 min",
                       "root_cause": "invented", "business_impact": None})
    assert out["symptoms"] == ["drops every 10 min"]
    assert "root_cause" not in out
    assert out["business_impact"] == ""


def test_fallback_never_invents_impact_or_cause() -> None:
    fields = D.fallback_draft(CONVERSATION)
    assert fields["business_impact"] == ""
    assert fields["troubleshooting_done"] == []
    assert fields["summary"]
    assert fields["missing_info"], "a fallback must say what is unknown"


def test_description_only_contains_filled_sections() -> None:
    text = D.compose_description({
        "problem": "VPN drops", "environment": "", "symptoms": ["every 10 min"],
        "error_messages": ["619"], "business_impact": "",
        "kb_links": [{"title": "VPN runbook", "url": "https://kb/1"}],
        "missing_info": ["When did it start?"],
    })
    assert "Problem" in text and "VPN drops" in text
    assert "Environment" not in text
    assert "Business impact" not in text
    assert "VPN runbook" in text and "https://kb/1" in text
    assert "Still needed" in text


def test_hash_is_stable_and_covers_the_approved_body() -> None:
    base = {"summary": "A", "description": "B", "project": "IT", "issue_type": "Task",
            "priority": "", "custom_fields": {}}
    assert D.content_hash(base) == D.content_hash(dict(base))
    assert D.content_hash(base) != D.content_hash({**base, "description": "B "})


def test_generate_draft_falls_back_when_no_llm(monkeypatch) -> None:
    import app.llm.client as client

    monkeypatch.setattr(client, "make_llm", lambda: None)
    fields, source = D.generate_draft(CONVERSATION)
    assert source == "fallback"
    assert fields["summary"]
