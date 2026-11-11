"""The "Improve with AI" assist rewrites the reporter's words — it does not invent a ticket.

The old control generated a fresh description from the subject, so opening the form from a
conversation handed back the assistant's answer as if the reporter had written it. The
description is now theirs alone: the model sees exactly that text and may only say it more
clearly (a support ticket that "adds" a system sends the wrong team to the wrong place).
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.api import tickets as tickets_api
from app.orchestration import orchestrator


class _Chain:
    def __init__(self, reply: str = "Rewritten."):
        self.reply = reply
        self.inputs: list[dict] = []

    def invoke(self, payload: dict) -> str:
        self.inputs.append(payload)
        return self.reply


def test_returns_the_rewritten_description(monkeypatch):
    chain = _Chain("VPN drops every few minutes on the 3rd floor; reconnecting restores it briefly.")
    monkeypatch.setattr(orchestrator, "answer_chain", lambda: chain)

    out = tickets_api.improve_description(
        tickets_api.ImproveDescriptionRequest(
            text="vpn keeps dropping on 3rd floor, reconnect fixes it for a bit"
        )
    )

    assert out["description"].startswith("VPN drops every few minutes")
    prompt = chain.inputs[0]["question"]
    assert "vpn keeps dropping on 3rd floor" in prompt  # the reporter's own text went in
    assert "never invent" in prompt
    assert "Burmese stays Burmese" in prompt


def test_empty_text_is_a_400_not_a_model_call(monkeypatch):
    called = []
    monkeypatch.setattr(orchestrator, "answer_chain", lambda: called.append(1))

    with pytest.raises(HTTPException) as exc:
        tickets_api.improve_description(tickets_api.ImproveDescriptionRequest(text="   "))

    assert exc.value.status_code == 400
    assert called == []


def test_no_model_key_is_a_clear_503(monkeypatch):
    monkeypatch.setattr(orchestrator, "answer_chain", lambda: None)

    with pytest.raises(HTTPException) as exc:
        tickets_api.improve_description(tickets_api.ImproveDescriptionRequest(text="printer offline"))

    assert exc.value.status_code == 503
    assert "not configured" in exc.value.detail


def test_a_model_failure_is_a_503_and_the_form_still_works(monkeypatch):
    class Boom:
        def invoke(self, payload):
            raise RuntimeError("upstream timeout")

    monkeypatch.setattr(orchestrator, "answer_chain", lambda: Boom())

    with pytest.raises(HTTPException) as exc:
        tickets_api.improve_description(tickets_api.ImproveDescriptionRequest(text="screen flickers"))

    assert exc.value.status_code == 503
    assert "improve failed" in exc.value.detail


def test_an_empty_completion_is_retried_once(monkeypatch):
    class Flaky:
        def __init__(self):
            self.calls = 0

        def invoke(self, payload):
            self.calls += 1
            return "" if self.calls == 1 else "- VPN drops on the 3rd floor."

    chain = Flaky()
    monkeypatch.setattr(orchestrator, "answer_chain", lambda: chain)

    out = tickets_api.improve_description(
        tickets_api.ImproveDescriptionRequest(text="vpn drops")
    )

    assert chain.calls == 2
    assert out["description"].startswith("- VPN drops")


def test_two_empty_completions_are_a_503_not_a_blank_description(monkeypatch):
    class Blank:
        def invoke(self, payload):
            return "   "

    monkeypatch.setattr(orchestrator, "answer_chain", lambda: Blank())

    with pytest.raises(HTTPException) as exc:
        tickets_api.improve_description(tickets_api.ImproveDescriptionRequest(text="vpn drops"))

    assert exc.value.status_code == 503
    assert "returned nothing" in exc.value.detail


def test_long_text_is_capped_before_the_prompt(monkeypatch):
    chain = _Chain("ok")
    monkeypatch.setattr(orchestrator, "answer_chain", lambda: chain)

    tickets_api.improve_description(tickets_api.ImproveDescriptionRequest(text="x" * 9000))

    import re

    runs = re.findall(r"x+", chain.inputs[0]["question"])
    assert max(len(r) for r in runs) == 4000  # the reporter's block, not the prompt's own x's
