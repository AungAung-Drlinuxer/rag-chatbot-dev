"""The Knowledge page's "Sources" figure must come from the rows, not a fixed list.

It printed `allProviders().length`, which is a hardcoded two-element array, so an
installation with only Confluence configured showed "2 sources". The count is now derived from
`kb_meta`, and this pins how one row is classified.
"""
from __future__ import annotations

import pytest

from app.api.knowledge import classify_source


@pytest.mark.parametrize(
    "url,page_id,expected",
    [
        ("https://aungaungxero.atlassian.net/wiki/spaces/IHKB/pages/1", "1", "confluence"),
        ("https://confluence.example.com/display/IHKB/Page", "42", "confluence"),
        ("", "77", "confluence"),          # legacy rows: bare numeric page id, no URL
        ("", "manual-3", "manual"),
        ("", "", "unknown"),
        ("https://elsewhere.example/page", "kb-9", "unknown"),
    ],
)
def test_classify_source(url, page_id, expected):
    assert classify_source(url, page_id) == expected


def test_article_sources_counts_each_provider(monkeypatch):
    """The endpoint itself must work — the page calls it on every load."""
    import app.persistence.database as db

    class _Res:
        def __init__(self, rows): self._rows = rows
        def fetchall(self): return self._rows

    class _S:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, *a, **k): return _Res([
            ("https://x.atlassian.net/wiki/1", "1"),
            ("https://x.atlassian.net/wiki/2", "2"),
            ("", "manual-7"),
        ])

    monkeypatch.setattr(db, "SessionLocal", lambda: _S())

    from app.api.knowledge import article_sources

    out = article_sources(user="diag")
    assert out["sources"] == [
        {"key": "confluence", "label": "Confluence", "count": 2},
        {"key": "manual", "label": "Manual", "count": 1},
    ]
