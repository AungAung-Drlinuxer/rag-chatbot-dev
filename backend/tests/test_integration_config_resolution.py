"""A saved integration is the whole configuration — the environment must not fill its gaps.

The failure this pins: Confluence had a base URL and an API token saved from the UI, but no
email, so `confluence_cfg()` fell back to `CONFLUENCE_EMAIL` from the deployment — a different
Atlassian account than the one that created the token. Every request returned 403, the sync
imported zero pages, and nothing in the UI said so.
"""
from __future__ import annotations

import pytest

from app.integrations import confluence as conf
from app.integrations import jira as jira_mod


@pytest.fixture(autouse=True)
def _reset_caches(monkeypatch):
    monkeypatch.setattr(conf, "_CFG", None, raising=False)
    monkeypatch.setattr(conf, "_CFG_AT", 0.0, raising=False)
    monkeypatch.setattr(jira_mod, "_JIRA_CFG_CACHE", None, raising=False)
    monkeypatch.setattr(jira_mod, "_JIRA_CFG_AT", 0.0, raising=False)


def test_saved_row_is_authoritative_and_does_not_borrow_the_env_email(monkeypatch):
    monkeypatch.setattr(conf, "_db_cfg", lambda: {"base_url": "https://x.atlassian.net/wiki",
                                                  "api_token": "tok"})
    monkeypatch.setattr(conf.SETTINGS, "confluence_email", "someone-else@corp.example", raising=False)
    monkeypatch.setattr(conf.SETTINGS, "confluence_base_url", "https://env.example/wiki", raising=False)

    cfg = conf.confluence_cfg()
    assert cfg["email"] == ""                       # missing stays missing, not env's
    assert cfg["base_url"] == "https://x.atlassian.net/wiki"
    assert cfg["api_token"] == "tok"


def test_env_is_used_only_when_nothing_is_saved(monkeypatch):
    monkeypatch.setattr(conf, "_db_cfg", dict)
    monkeypatch.setattr(conf.SETTINGS, "confluence_base_url", "https://env.example/wiki", raising=False)
    monkeypatch.setattr(conf.SETTINGS, "confluence_email", "env@corp.example", raising=False)
    monkeypatch.setattr(conf.SETTINGS, "confluence_token", "env-token", raising=False)

    cfg = conf.confluence_cfg()
    assert cfg["base_url"] == "https://env.example/wiki"
    assert cfg["email"] == "env@corp.example"


def test_legacy_token_key_is_still_read(monkeypatch):
    monkeypatch.setattr(conf, "_db_cfg", lambda: {"base_url": "https://x/wiki", "token": "old"})
    assert conf.confluence_cfg()["api_token"] == "old"


def test_jira_saved_row_is_authoritative(monkeypatch):
    import json

    class _Row:
        def __init__(self, value): self._value = value
        def first(self): return (self._value,)

    class _Session:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, *a, **k): return _Row(json.dumps({"base_url": "https://x.atlassian.net",
                                                            "api_token": "tok", "project_key": "AB"}))
        def commit(self): pass

    monkeypatch.setattr(jira_mod.SETTINGS, "jira_email", "someone-else@corp.example", raising=False)

    import app.persistence.database as db
    monkeypatch.setattr(db, "SessionLocal", lambda: _Session())

    cfg = jira_mod._jira_cfg()
    assert cfg["email"] == ""
    assert cfg["project"] == "AB"
