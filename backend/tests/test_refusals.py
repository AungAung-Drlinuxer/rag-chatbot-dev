"""Every guardrail verdict must map to a policy-aligned, non-echoing answer."""
from __future__ import annotations

import pytest

from app.security.refusals import REFUSALS, is_blocked, refusal_for

TYPES = ["injection", "pii", "profanity", "toxic", "overflow"]


@pytest.mark.parametrize("gtype", TYPES)
def test_every_guardrail_type_has_an_answer(gtype: str) -> None:
    text = refusal_for(gtype)
    assert len(text) > 80, "a refusal is a real answer, not a label"
    assert "IT" in text, "each refusal points the user at what it can help with"


@pytest.mark.parametrize("gtype", TYPES)
def test_case_and_whitespace_do_not_matter(gtype: str) -> None:
    assert refusal_for(f"  {gtype.upper()} ") == REFUSALS[gtype]


def test_unknown_type_still_gets_a_policy_answer() -> None:
    assert refusal_for("something_new") == refusal_for("")
    assert "content policy" in refusal_for("something_new").lower()


def test_refusals_never_contain_placeholder_text() -> None:
    for gtype, text in REFUSALS.items():
        assert "{" not in text and "}" not in text, gtype
        assert "v1." not in text, f"{gtype}: a user cannot act on an internal version number"


def test_blocked_vs_flagged_split() -> None:
    # Blocked: never reaches the model. Flagged: answered with the refusal, no model call
    # either today, but the two are distinguished for metrics and the UI.
    assert is_blocked("injection") is True
    assert is_blocked("pii") is True
    assert is_blocked("overflow") is True
    assert is_blocked("profanity") is False
    assert is_blocked("toxic") is False


def test_pii_refusal_names_the_data_not_the_value() -> None:
    text = refusal_for("pii")
    assert "card number" in text.lower()
    assert "api key" in text.lower()
    assert "never send credentials" in text.lower()
