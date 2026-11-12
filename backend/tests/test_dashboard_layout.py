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


def test_geometry_round_trips():
    out = normalise_panels([
        {"id": "a", "type": "trend", "span": 6, "x": 0, "y": 0, "h": 5, "options": {}},
        {"id": "b", "type": "note", "span": 6, "x": 6, "y": 0, "h": 3, "options": {}},
    ])
    assert [(p["x"], p["y"], p["h"]) for p in out] == [(0, 0, 5), (6, 0, 3)]


def test_geometry_is_clamped_not_rejected():
    # A stale client (or a hand-written row) should load as a usable board, not a 422.
    out = normalise_panels([{"id": "a", "type": "trend", "span": 12, "x": 9, "y": -4, "h": 99}])
    assert out[0]["x"] == 0          # a full-width panel cannot start at column 9
    assert out[0]["y"] == 0
    assert out[0]["h"] == 12


def test_a_legacy_layout_without_positions_still_saves():
    out = normalise_panels([{"id": "a", "type": "kpis", "span": 12, "options": {}}])
    assert out[0]["x"] == 0 and out[0]["y"] == 0 and out[0]["h"] == 4


def test_non_numeric_geometry_falls_back_instead_of_erroring():
    out = normalise_panels([{"id": "a", "type": "kpis", "span": 6, "x": "left", "y": None, "h": "tall"}])
    assert out[0]["x"] == 0 and out[0]["y"] == 0 and out[0]["h"] == 4


# ---------------------------------------------------------------- board geometry (spans/bands)

def test_board_geometry_is_clamped_not_rejected():
    """A saved board outlives the release that wrote it; insane numbers must still load."""
    from app.api.dashboard import BoardIn, _normalise_board

    out = _normalise_board(BoardIn(
        spans={"kpis": 99, "trend": -4, "quality": 3, "junk": "x"},
        bands=[
            {"min": 112, "fr": 0, "auto": True},
            {"min": 5, "fr": -2},
            {"min": 99999, "fr": 40},
            "not-a-band",
        ],
    ))

    assert out["spans"] == {"kpis": 12, "trend": 1, "quality": 3}
    assert out["bands"][0] == {"min": 112, "fr": 0.0, "auto": True}
    assert out["bands"][1]["min"] == 60 and out["bands"][1]["fr"] == 0.0
    assert out["bands"][2]["min"] == 1200 and out["bands"][2]["fr"] == 8.0
    assert len(out["bands"]) == 3


def test_board_key_is_per_user_and_fits_the_column():
    from app.api.dashboard import _board_key

    assert _board_key("ith@admin") == "board_layout:ith@admin"
    assert len(_board_key("u" * 400)) <= 128
