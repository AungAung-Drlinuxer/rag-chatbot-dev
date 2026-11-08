"""Confluence pagination must advance, or the sync imports nothing and never returns.

The bug this pins: the first request carried the CQL, and every follow-up was fetched with the
same `params` on top of `_links.next`, so Confluence answered with page one forever. The sync
looped until the request timed out, leaving `kb_meta` and `langchain_pg_embedding` empty while
the UI happily reported that it had run.
"""
from __future__ import annotations

import httpx
import pytest

from app.integrations import confluence as conf


class _Resp:
    def __init__(self, payload): self._payload = payload
    def raise_for_status(self): return None
    def json(self): return self._payload


class _Client:
    def __init__(self, pages, calls):
        self._pages = pages
        self._calls = calls

    def __enter__(self): return self
    def __exit__(self, *exc): return False

    def get(self, url, params=None):
        self._calls.append((url, params))
        return _Resp(self._pages.pop(0))


def _page(page_id, title, next_link=None):
    payload = {
        "results": [{
            "id": page_id,
            "title": title,
            "body": {"storage": {"value": f"<p>{title} body</p>"}},
            "_links": {"webui": f"/spaces/IHKB/pages/{page_id}"},
        }],
    }
    if next_link:
        payload["_links"] = {"next": next_link}
    return payload


@pytest.fixture(autouse=True)
def _cfg(monkeypatch):
    monkeypatch.setattr(conf, "_CFG", None, raising=False)
    monkeypatch.setattr(conf, "_CFG_AT", 0.0, raising=False)
    monkeypatch.setattr(conf, "_CFG_TTL", -1, raising=False)  # always recompute
    monkeypatch.setattr(conf, "confluence_cfg", lambda: {
        "base_url": "https://x.atlassian.net/wiki", "email": "a@b.c",
        "api_token": "t", "cloud_id": "", "space_keys": "IHKB"})


def test_followup_requests_do_not_resend_the_cql_and_every_page_is_read(monkeypatch):
    calls: list = []
    pages = [
        _page("1", "First", next_link="/rest/api/content/search?start=1&limit=1"),
        _page("2", "Second"),
    ]
    monkeypatch.setattr(httpx, "Client", lambda **kw: _Client(pages, calls))

    docs = conf.fetch_space("IHKB")

    assert [d["title"] for d in docs] == ["First", "Second"]
    assert calls[0][1]["cql"].startswith('space = "IHKB"')   # first call carries the query
    assert calls[1][1] is None                               # follow-up carries only the cursor
    assert calls[1][0].endswith("/rest/api/content/search?start=1&limit=1")


def test_a_cursor_that_does_not_advance_is_not_followed_forever(monkeypatch):
    calls: list = []
    link = "/rest/api/content/search?start=1"
    pages = [_page("1", "A", next_link=link), _page("1", "A", next_link=link),
             _page("1", "A", next_link=link)]
    monkeypatch.setattr(httpx, "Client", lambda **kw: _Client(pages, calls))

    docs = conf.fetch_space("IHKB")

    assert len(docs) == 2          # the repeated page is still parsed, the loop then stops
    assert len(calls) == 2         # no third fetch of the same cursor
