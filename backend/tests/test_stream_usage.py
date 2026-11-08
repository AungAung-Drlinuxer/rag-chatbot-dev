"""Tests for stream_answer token-usage contract (Phase 10.1).

`stream_answer` should yield (token, usage) pairs. The LAST pair carries a dict
with input_tokens/output_tokens/total_tokens when the model reports usage;
intermediate pairs carry usage=None. When no API key is set the dev mock yields
just (token, None) pairs (no usage).
"""
from app.llm import client as llm_mod


def test_stream_answer_dev_mock_yields_no_usage():
    pairs = list(llm_mod.stream_answer("q", "ctx"))
    assert pairs, "dev mock should produce at least one pair"
    for tok, usage in pairs[:-1]:
        assert usage is None
        assert isinstance(tok, str)
    # Final pair from dev mock also has usage=None (no LLM was called)
    assert pairs[-1][1] is None


def test_extract_usage_from_aimessagechunk():
    """_extract_usage should read usage_metadata first, then response_metadata.usage."""
    from app.llm.client import _extract_usage

    class _FakeChunk:
        def __init__(self, usage_metadata=None, response_metadata=None):
            self.usage_metadata = usage_metadata
            self.response_metadata = response_metadata

    # usage_metadata takes precedence
    chunk = _FakeChunk(
        usage_metadata={"input_tokens": 12, "output_tokens": 7, "total_tokens": 19},
        response_metadata={"usage": {"input_tokens": 999, "output_tokens": 0, "total_tokens": 999}},
    )
    assert _extract_usage(chunk) == {"input_tokens": 12, "output_tokens": 7, "total_tokens": 19}

    # Falls back to response_metadata.usage
    chunk2 = _FakeChunk(response_metadata={"usage": {"input_tokens": 5, "output_tokens": 3, "total_tokens": 8}})
    assert _extract_usage(chunk2) == {"input_tokens": 5, "output_tokens": 3, "total_tokens": 8}

    # None when missing
    assert _extract_usage(_FakeChunk()) is None
    assert _extract_usage(None) is None
