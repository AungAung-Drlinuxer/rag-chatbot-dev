"""Retention policy — the parts that decide what gets deleted.

The destructive path is exercised against a real database in the deploy check; these tests
pin the rules that must never drift: only the offered windows, `None` means forever, and a
cutoff is never "now" (which would delete everything).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.retention import ALLOWED_DAYS, _cutoff, set_policy


def test_allowed_windows_are_the_ones_the_ui_offers():
    assert ALLOWED_DAYS == {30, 90, 180, 365}


def test_null_means_keep_forever_not_zero_days():
    assert _cutoff(None) is None
    assert _cutoff(0) is None


def test_cutoff_is_in_the_past_by_exactly_the_window():
    now = datetime(2026, 11, 13, tzinfo=UTC)
    assert _cutoff(365, now) == now - timedelta(days=365)


@pytest.mark.parametrize("bad", [7, 59, 366, 999])
def test_rejects_windows_the_ui_does_not_offer(bad):
    with pytest.raises(ValueError):
        set_policy(bad, None)


def test_accepts_forever_for_both_scopes(monkeypatch):
    """`None` must be storable — it is the safe default, not an error."""
    import app.retention as retention

    monkeypatch.setattr(retention, "_session", lambda: _NoopSession())
    monkeypatch.setattr(retention, "get_policy", lambda: {"conversations_days": None, "audit_days": None})
    assert retention.set_policy(None, None) == {"conversations_days": None, "audit_days": None}


class _NoopSession:
    def __enter__(self):
        class _S:
            def execute(self, *a, **k):
                return None

            def commit(self):
                return None

        return _S()

    def __exit__(self, *exc):
        return False
