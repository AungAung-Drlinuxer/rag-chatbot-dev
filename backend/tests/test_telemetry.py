"""Phase 8 — telemetry best-effort tests (no LGTM endpoints → no-ops, never raise)."""
from app.config import SETTINGS
from app.observability.telemetry import record_counter, record_histogram, setup_telemetry, start_span


def test_setup_telemetry_noop_without_endpoints(monkeypatch):
    monkeypatch.setattr(SETTINGS, "tempo_otlp_url", "")
    setup_telemetry()  # must not raise
    assert True


def test_record_counter_noop(monkeypatch):
    monkeypatch.setattr(SETTINGS, "tempo_otlp_url", "")
    record_counter("x", 1)
    record_histogram("y", 1.0)
    assert True


def test_start_span_noop():
    with start_span("test.span") as span:
        span.set_attribute("k", "v")  # must not raise (no-op when disabled)
    assert True
