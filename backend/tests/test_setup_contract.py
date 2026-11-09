"""Contract between the installer, the ORM and the readiness report.

WHY THIS EXISTS
---------------
Three places describe "the tables this application needs": the ORM metadata, the hand-written
core-table list in `app.bootstrap`, and the `REQUIRED_TABLES` constant that decides whether
the readiness strip says the database is fine. They drifted silently once already (a table
added to `init_db` and to neither list means a fresh install reports "ready" and then fails
at first use). These tests make the drift a test failure instead.
"""
from __future__ import annotations

from app import bootstrap
from app.api.setup import REQUIRED_TABLES
from app.persistence.models import Base


def test_required_table_count_matches_orm_and_core_tables():
    expected = set(Base.metadata.tables) | set(bootstrap.CORE_TABLES)
    assert REQUIRED_TABLES == len(expected)


def test_installer_and_readiness_agree_on_the_table_set():
    assert set(bootstrap._expected_tables()) == set(Base.metadata.tables) | set(bootstrap.CORE_TABLES)


def test_core_tables_are_not_also_orm_models():
    # A table listed in both places is harmless at runtime but signals a stale list; keeping
    # them disjoint makes `len(expected)` provable rather than a coincidence.
    overlap = set(bootstrap.CORE_TABLES) & set(Base.metadata.tables)
    assert not overlap, f"listed as both ORM and core: {sorted(overlap)}"


def test_has_requires_every_field_not_just_one():
    from app.api.setup import _has

    cfg = {"base_url": "https://x.atlassian.net/wiki", "token": "t", "email": ""}
    assert _has(cfg, "base_url", "token") is True
    assert _has(cfg, "base_url", "token", "email") is False
    # Whitespace is not configuration.
    assert _has({"base_url": "   "}, "base_url") is False


def test_readiness_route_is_mounted_under_api():
    # Routers here declare absolute paths (no global prefix). A missing /api prefix returns
    # 404 through the ingress while the endpoint works in-process — exactly the failure this
    # test exists to make impossible.
    from app.api.setup import router

    paths = [r.path for r in router.routes]
    assert "/api/setup/readiness" in paths


def test_integration_readiness_reads_the_field_names_the_panels_write(monkeypatch):
    # The panels store `api_token` and LDAP's `host`; a check that looks for `token`/`server`
    # says "not connected" on a working install, and the admin sees a green test connection
    # next to a red checklist. Pin the names.
    from app.api import setup

    rows = {
        "confluence": {"base_url": "https://x.atlassian.net/wiki", "api_token": "t", "email": "e@x"},
        "jira": {"base_url": "https://x.atlassian.net", "api_token": "t", "email": "e@x",
                 "project_key": "ITHD"},
        "ldap": {"host": "ldap://dc01", "base_dn": "DC=corp", "bind_dn": "CN=svc"},
        "keycloak": {},
    }
    monkeypatch.setattr(setup, "_settings", lambda _s, key: rows.get(key, {}))
    monkeypatch.setattr(setup, "_has", setup._has)

    out = setup._integrations(None)
    assert out["jira"]["configured"] is True
    assert out["jira"]["project"] == "ITHD"
    assert out["ldap"]["configured"] is True
    assert out["keycloak"]["configured"] is False
