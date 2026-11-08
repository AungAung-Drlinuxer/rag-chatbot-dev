"""Tests for the runtime-tunable settings helper (Phase 10.1)."""
from app import runtime


def test_runtime_metadata_returns_whitelisted_keys():
    md = runtime.metadata()
    keys = {row["key"] for row in md}
    assert "retrieval_top_k" in keys
    assert "confidence_gate_threshold" in keys
    assert "max_context_tokens" in keys


def test_runtime_get_returns_default_when_unset():
    assert runtime.get("retrieval_top_k") == 5
    assert runtime.get("confidence_gate_threshold") == 0.75


def test_runtime_set_then_get_round_trip():
    runtime.set_("retrieval_top_k", 9)
    try:
        assert runtime.get("retrieval_top_k") == 9
    finally:
        runtime.reset("retrieval_top_k")
    assert runtime.get("retrieval_top_k") == 5


def test_runtime_set_typed_for_string_value():
    """set_ must coerce through the declared type even when the caller passes a string."""
    runtime.set_("retrieval_top_k", "12")
    try:
        assert runtime.get("retrieval_top_k") == 12
        assert isinstance(runtime.get("retrieval_top_k"), int)
    finally:
        runtime.reset("retrieval_top_k")


def test_runtime_set_rejects_non_whitelisted_key():
    try:
        runtime.set_("not_a_real_key", 1)
    except KeyError:
        return
    raise AssertionError("expected KeyError for non-whitelisted key")


def test_runtime_reset_is_idempotent():
    runtime.reset("retrieval_top_k")  # no-op if already absent
    runtime.reset("retrieval_top_k")  # still no-op
    assert runtime.get("retrieval_top_k") == 5
