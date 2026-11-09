"""The default ceiling has to survive a normal page load, and a burst must not flood the
audit table with one row per rejected request."""
from __future__ import annotations

import pytest

from app.security import rate_limit


class _Pipe:
    def __init__(self, store: dict):
        self.store = store
        self.key = ""

    def incr(self, key: str) -> "_Pipe":
        self.key = key
        self.store[key] = self.store.get(key, 0) + 1
        return self

    def expire(self, _key: str, _ttl: int) -> "_Pipe":
        return self

    def execute(self) -> list[int]:
        return [self.store[self.key]]


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, int] = {}
        self.flags: set[str] = set()

    def pipeline(self) -> _Pipe:
        return _Pipe(self.store)

    def set(self, key: str, value: str, ex: int | None = None, nx: bool = False):
        if nx and key in self.flags:
            return None
        self.flags.add(key)
        return True


@pytest.fixture()
def fake(monkeypatch):
    redis = FakeRedis()
    monkeypatch.setattr(rate_limit, "_redis", lambda: redis)
    audits: list[tuple] = []
    import app.observability.audit as audit_mod

    monkeypatch.setattr(audit_mod, "audit", lambda *a, **k: audits.append((a, k)))
    return redis, audits


def test_default_ceiling_is_not_a_page_load_budget() -> None:
    # Regression: 60/min throttled a logged-in user doing nothing unusual. Anything at or
    # below 100 is the bug coming back.
    assert rate_limit.LIMITS["default"][0] >= 240
    assert rate_limit.LIMITS["default"][1] == 60


def test_a_burst_writes_one_audit_row_per_window(fake, monkeypatch) -> None:
    redis, audits = fake
    monkeypatch.setitem(rate_limit.LIMITS, "default", (2, 60))

    allowed = [rate_limit.check_limit("default", "user:x")[0] for _ in range(8)]

    assert allowed[:2] == [True, True]
    assert allowed[2:] == [False] * 6
    assert len(audits) == 1, f"one row per window, got {len(audits)}"


def test_retry_after_is_within_the_window(fake, monkeypatch) -> None:
    _redis, _audits = fake
    monkeypatch.setitem(rate_limit.LIMITS, "default", (1, 60))

    rate_limit.check_limit("default", "user:y")
    allowed, retry_after = rate_limit.check_limit("default", "user:y")

    assert allowed is False
    assert 1 <= retry_after <= 61


def test_fails_open_when_redis_is_missing(monkeypatch) -> None:
    monkeypatch.setattr(rate_limit, "_redis", lambda: None)
    assert rate_limit.check_limit("default", "user:z") == (True, 0)
