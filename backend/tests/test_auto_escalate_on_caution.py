"""`auto_escalate_on_caution` — the setting must actually escalate.

The regression this guards: the setting was stored on `user_settings`, served by
GET /api/settings and typed in the frontend, and read by NO logic. A below-threshold
answer showed the caution banner and stopped there, so the human the setting promises
never saw the question. Every test here fails against that dead version — that is the
point.

`_node_tools` is the escalation trigger: it runs after the confidence gate, sees the
gate's own `decision`, and is what `_route_after_tools` reads to choose
approval-vs-END. So it is tested directly rather than through a full graph run — the
graph needs Postgres checkpoints, an LLM and an embedder, and none of that is what
this behaviour depends on.
"""
from typing import cast

from app.graph_rag import RAGState, _auto_escalate, _node_tools
from app.persistence.database import SessionLocal
from app.persistence.models import UserSettings
from app.rag.gate import DECISION_CAUTION

USER = "__test_auto_escalate__"


def _set_pref(value: bool) -> None:
    """Write the user's own preference row, the way PUT /api/settings would."""
    s = SessionLocal()
    try:
        row = s.get(UserSettings, USER)
        if row is None:
            row = UserSettings(username=USER, auto_escalate_on_caution=value)
            s.add(row)
        else:
            row.auto_escalate_on_caution = value
        s.commit()
    finally:
        s.close()


def _drop() -> None:
    s = SessionLocal()
    try:
        row = s.get(UserSettings, USER)
        if row is not None:
            s.delete(row)
            s.commit()
    finally:
        s.close()


def _state(question: str, decision: str, confidence: float = 0.4) -> RAGState:
    """The minimum state `_node_tools` reads, as the gate would have left it."""
    return cast(RAGState, {
        "question": question,
        "user": USER,
        "decision": decision,
        "confidence": confidence,
        "docs": [],
        "context": "",
    })


# --- the preference lookup itself -------------------------------------------


def test_preference_defaults_to_false_for_an_unknown_user():
    """No row (never opened Settings) is NOT an opt-in."""
    assert _auto_escalate("__nobody_has_this_row__") is False


def test_preference_is_false_without_a_username():
    """An anonymous turn can never be escalated on a user's behalf."""
    assert _auto_escalate(None) is False
    assert _auto_escalate("") is False


def test_preference_round_trips_through_the_users_own_row():
    _set_pref(True)
    try:
        assert _auto_escalate(USER) is True
        _set_pref(False)
        assert _auto_escalate(USER) is False
    finally:
        _drop()


# --- the trigger -------------------------------------------------------------


def test_caution_with_the_setting_off_does_not_escalate():
    """The default. A low-confidence answer stays an answer."""
    _set_pref(False)
    try:
        out = _node_tools(_state("how do I reset a VPN profile?", DECISION_CAUTION))
        assert out["needs_approval"] is False
    finally:
        _drop()


def test_caution_with_the_setting_on_escalates():
    """THE fix: a below-threshold answer now reaches a human."""
    _set_pref(True)
    try:
        out = _node_tools(_state("how do I reset a VPN profile?", DECISION_CAUTION))
        assert out["needs_approval"] is True
        # The admin queue distinguishes the two reasons it can be asked.
        assert out["tool_used"] == "escalation"
    finally:
        _drop()


def test_a_confident_answer_never_escalates_even_with_the_setting_on():
    """The gate's verdict is the trigger — the setting does not bypass it."""
    _set_pref(True)
    try:
        out = _node_tools(_state("how do I reset a VPN profile?", "answer", confidence=0.93))
        assert out["needs_approval"] is False
    finally:
        _drop()


def test_a_ticket_request_escalates_regardless_of_the_setting():
    """The pre-existing rule must survive: create-ticket intent always needs approval."""
    _set_pref(False)
    try:
        out = _node_tools(_state("please create a ticket for the printer on floor 3",
                                 "answer", confidence=0.95))
        assert out["needs_approval"] is True
        assert out["tool_used"] == "tickets"
    finally:
        _drop()
