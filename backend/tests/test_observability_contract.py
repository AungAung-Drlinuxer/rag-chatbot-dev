"""Observability API contract.

The page is only as honest as this endpoint: a wrong window, a missing percentile or a
silently omitted table turns a dashboard into decoration. These tests pin the parts that can
be checked without a database: the routes exist under /api, the window maths, and the fact
that usage is written to a table rather than kept in process memory.
"""
from __future__ import annotations

import inspect
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.api import observability


def test_routes_are_mounted_under_api():
    import app.main

    paths = app.main.app.openapi()["paths"]
    assert "/api/observability/overview" in paths
    assert "/api/observability/events" in paths


def test_a_default_window_is_seven_days():
    start, end, label = observability._window(7, None, None)
    assert label == "Last 7 days"
    assert timedelta(days=6, hours=23) < (end - start) <= timedelta(days=7)


def test_days_are_clamped_to_a_year():
    start, end, _ = observability._window(100000, None, None)
    assert (end - start) <= timedelta(days=90)


def test_a_custom_range_includes_the_whole_end_day():
    start, end, label = observability._window(7, "2026-11-01", "2026-11-03")
    # "to 2026-11-03" must cover the 3rd, not stop at its midnight.
    assert end.date().isoformat() == "2026-11-04"
    assert label == "2026-11-01 → 2026-11-03"


def test_an_inverted_or_unparseable_range_is_rejected_with_a_sentence():
    with pytest.raises(HTTPException) as bad_order:
        observability._window(7, "2026-11-05", "2026-11-01")
    assert bad_order.value.status_code == 400
    assert "before" in bad_order.value.detail

    with pytest.raises(HTTPException) as unparseable:
        observability._window(7, "last tuesday", None)
    assert unparseable.value.status_code == 400


def test_a_range_longer_than_a_year_is_refused():
    with pytest.raises(HTTPException) as exc:
        observability._window(7, "2020-01-01", "2026-01-01")
    assert exc.value.status_code == 400
    assert "366" in exc.value.detail


def test_the_events_list_is_admin_only():
    source = inspect.getsource(observability.observability_events)
    assert 'get_role(user) != "admin"' in source


def test_usage_is_written_to_a_table_not_only_to_prometheus():
    from app.observability import usage

    source = inspect.getsource(usage.record_usage)
    assert "INSERT INTO llm_usage" in source
    # A metrics/DB hiccup must never fail the answer that was already streamed.
    assert "except Exception" in source


def test_the_chat_path_records_usage():
    from app.api import chat

    source = inspect.getsource(chat)
    assert "record_usage(" in source


def test_costs_are_cast_to_float_for_the_client():
    # NUMERIC serialises as a JSON string, and a string reaching a toFixed() call crashes the
    # page; the cast belongs in SQL, once, rather than in every formatter.
    source = inspect.getsource(observability.observability_overview)
    assert "::float AS cost" in source
