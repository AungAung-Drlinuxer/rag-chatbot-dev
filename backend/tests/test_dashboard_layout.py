"""Overview layout: validation and route contract.

The contract that matters here is not the SQL — it is that a layout the frontend can produce
is always savable, and that a layout it should never produce is rejected with a sentence
instead of a 500 or a silently truncated board.
"""
from app.api.dashboard import MAX_PANELS, normalise_panels, router


def test_a_typical_layout_round_trips_unchanged():
    panels = [
        {"id": "attention", "type": "attention", "title": "", "span": 12, "options": {}},
        {"id": "n1", "type": "note", "title": "  On-call  ", "span": 6,
         "options": {"body": "Rotate the key on Monday."}},
    ]
    out = normalise_panels(panels)
    assert [p["type"] for p in out] == ["attention", "note"]
    assert out[0]["span"] == 12 and out[0]["title"] == ""
    # Titles are trimmed before storage: a leading space is invisible in the UI and would make
    # "same panel, different bytes" show up as a diff on every save.
    assert out[1]["title"] == "On-call"
    assert out[1]["options"]["body"].startswith("Rotate")


def test_unknown_panel_types_survive_a_save():
    # A layout saved by a newer deployment must not be destroyed by an older API.
    out = normalise_panels([{"id": "x", "type": "future-panel", "span": 4, "options": {"a": 1}}])
    assert out[0]["type"] == "future-panel"
    assert out[0]["options"] == {"a": 1}


def test_span_is_bounded_to_the_grid():
    out = normalise_panels([
        {"id": "a", "type": "kpis", "span": 1},
        {"id": "b", "type": "kpis", "span": 99},
    ])
    assert [p["span"] for p in out] == [3, 12]


def test_duplicate_ids_are_refused():
    import pytest
    with pytest.raises(ValueError, match="duplicate panel id"):
        normalise_panels([
            {"id": "same", "type": "kpis"},
            {"id": "same", "type": "trend"},
        ])


def test_a_panel_needs_an_id_and_a_type():
    import pytest
    with pytest.raises(ValueError, match="needs an id"):
        normalise_panels([{"id": "", "type": "kpis"}])
    with pytest.raises(ValueError, match="needs a type"):
        normalise_panels([{"id": "p1", "type": ""}])


def test_a_board_cannot_grow_without_bound():
    import pytest
    with pytest.raises(ValueError, match=f"at most {MAX_PANELS}"):
        normalise_panels([{"id": f"p{i}", "type": "note"} for i in range(MAX_PANELS + 1)])


def test_non_numeric_span_is_reported_as_a_span_problem():
    import pytest
    with pytest.raises(ValueError, match="span must be a number"):
        normalise_panels([{"id": "p", "type": "note", "span": "wide"}])


def test_layout_routes_are_mounted_under_api():
    # Routers in this app declare absolute paths; a missing /api prefix works in-process and
    # 404s through the ingress, which is exactly the bug this pins.
    paths = {r.path for r in router.routes}
    assert "/api/dashboard/layout" in paths
    methods = {
        m
        for r in router.routes
        if getattr(r, "path", None) == "/api/dashboard/layout"
        for m in getattr(r, "methods", set())
    }
    assert {"GET", "PUT", "DELETE"} <= methods
