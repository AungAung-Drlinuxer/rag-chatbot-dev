"""The decision half of directory reconciliation — no database, no LDAP."""
from __future__ import annotations

from app.auth.directory_sync import plan


def row(username, *, dn="cn=x,dc=corp", state="active", misses=0):
    return {"username": username, "ldap_dn": dn, "state": state, "missing_scans": misses}


def test_active_account_is_left_alone():
    out = plan([row("alice")], {"alice"}, set())


def test_names_are_compared_case_insensitively():
    # AD returns "Alice"; the row says "alice" — this must not read as a deletion.
    out = plan([row("alice")], {"alice"}, set())
    out = plan([row("alice")], {"alice"}, set())
    assert out["remove"] == [] and out["missing"] == []
    out2 = plan([row("Alice")], {"alice"}, set())
    assert out2["remove"] == [] and out2["missing"] == []
    assert out["restore"] == out["suspend"] == out["remove"] == out["missing"] == []


def test_disabled_in_the_directory_is_suspended_not_deleted():
    out = plan([row("alice")], set(), {"alice"})
    assert out["suspend"] == ["alice"]
    assert out["remove"] == []


def test_a_first_miss_only_strikes_once():
    out = plan([row("alice", misses=0)], set(), set())
    assert out["missing"] == ["alice"]
    assert out["remove"] == []


def test_a_second_miss_removes_the_account():
    out = plan([row("alice", misses=1)], set(), set())
    assert out["remove"] == ["alice"]
    assert out["missing"] == []


def test_a_known_removed_account_is_not_planned_again():
    out = plan([row("alice", state="removed")], set(), set())
    assert out["remove"] == [] and out["missing"] == []


def test_reappearing_in_the_directory_restores_the_row():
    out = plan([row("alice", state="removed")], {"alice"}, set())
    assert out["restore"] == ["alice"]


def test_local_accounts_are_never_touched():
    out = plan([row("backup-svc", dn=None)], set(), set())
    assert out["remove"] == [] and out["missing"] == []


def test_a_mass_disappearance_is_refused_without_force():
    rows = [row(f"user{i}") for i in range(10)]
    out = plan(rows, {"user0"}, set())
    assert out["blocked"] is True
    assert out["remove"] == [] and out["missing"] == []
    assert "vanished at once" in out["reason"]


def test_force_allows_the_mass_removal():
    rows = [row(f"user{i}", misses=1) for i in range(10)]
    out = plan(rows, {"user0"}, set(), force=True)
    assert out["blocked"] is False
    assert len(out["remove"]) == 9