"""OpenTelemetry → external LGTM (Tempo traces / Mimir metrics), best-effort NEVER raises.

No OTLP endpoints configured (e.g. dev without the LGTM stack) → every call is a no-op,
so telemetry failure can never break a chat request (design: observability is additive).
"""
from __future__ import annotations

import logging

from app.config import SETTINGS

logger = logging.getLogger("telemetry")

_enabled = False
_tracer = None
_meter = None
_counters: dict = {}
_histograms: dict = {}


def setup_telemetry() -> None:
    """Initialise the OTel SDK + exporters. Call once at startup; never raises."""
    global _enabled, _tracer, _meter
    try:
        if not SETTINGS.tempo_otlp_url:
            return
        from opentelemetry import metrics, trace
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.metrics import MeterProvider
        from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create({"service.name": SETTINGS.service_name})
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=SETTINGS.tempo_otlp_url)))
        trace.set_tracer_provider(provider)
        _tracer = trace.get_tracer(SETTINGS.service_name)

        if SETTINGS.mimir_otlp_url:
            reader = PeriodicExportingMetricReader(OTLPMetricExporter(endpoint=SETTINGS.mimir_otlp_url))
            meter_provider = MeterProvider(resource=resource, metric_readers=[reader])
            metrics.set_meter_provider(meter_provider)
            _meter = metrics.get_meter(SETTINGS.service_name)

        _enabled = True
        logger.info("telemetry enabled (tempo=%s mimir=%s)", SETTINGS.tempo_otlp_url, SETTINGS.mimir_otlp_url)
    except Exception as exc:
        logger.warning(f"telemetry disabled ({type(exc).__name__}): {exc}")


def start_span(name: str, attrs: dict | None = None):
    """Return a context-managed span (or None when disabled). Use with `with`."""
    if not _enabled or _tracer is None:
        return _null_span()
    return _tracer.start_as_current_span(name, attributes=attrs or {})


def start_span_with_kind(name: str, kind: str, attrs: dict | None = None):
    """Span with an explicit OpenTelemetry span kind (SERVER/CLIENT/PRODUCER/CONSUMER).

    Required for the Tempo service graph: the servicegraph connector only pairs
    CLIENT/SERVER spans to build request edges. Best-effort — no-op when
    telemetry is disabled or the kind string is invalid.
    """
    if not _enabled or _tracer is None:
        return _null_span()
    try:
        from opentelemetry.trace import SpanKind
        span_kind = getattr(SpanKind, kind.upper(), SpanKind.INTERNAL)
    except Exception:
        span_kind = SpanKind.INTERNAL
    return _tracer.start_as_current_span(name, kind=span_kind, attributes=attrs or {})


def _null_span():
    return _null_span_context()


class _null_span_context:
    def __init__(self): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def set_attribute(self, *a, **k): return None


class _quiet_span:
    """Context-managed span that suppresses the harmless
    'Failed to detach context' ValueError noise when a span survives
    across asyncio context switches.

    The SSE streaming generator (`def gen()` in chat.py) is resumed by
    Starlette in a *different* contextvars Context on every yield, so the
    contextvars Token created when the span opened cannot be reset when it
    closes. OpenTelemetry logs the full ValueError traceback every time —
    noisy but harmless: the span is already complete and exported.

    This wrapper delegates everything to the real span object and swallows
    only that specific ValueError on exit.
    """

    def __init__(self, cm):
        self._cm = cm
        self._span = None

    def __enter__(self):
        self._span = self._cm.__enter__()
        return self._span

    def __exit__(self, exc_type, exc, tb):
        try:
            return self._cm.__exit__(exc_type, exc, tb)
        except ValueError as exc:
            # openetelemetry.context: Token was created in a different Context
            if "was created in a different Context" in str(exc):
                logger.debug("span context detach skipped across asyncio context switch")
                return False
            raise

    def set_attribute(self, key, value):
        if self._span is not None and hasattr(self._span, "set_attribute"):
            self._span.set_attribute(key, value)

    def __getattr__(self, name):
        if self._span is not None:
            return getattr(self._span, name)
        return lambda *a, **k: None


def start_quiet_span(name: str, kind: str | None = None, attrs: dict | None = None):
    """start_span/start_span_with_kind wrapper safe for SSE generator spans.

    Use for any span whose `with` block spans multiple `yield`s.
    """
    cm = start_span_with_kind(name, "SERVER", attrs) if kind else start_span(name, attrs)
    return _quiet_span(cm)


def record_counter(name: str, value: int = 1, attrs: dict | None = None) -> None:
    if not _enabled or _meter is None:
        return
    if name not in _counters:
        _counters[name] = _meter.create_counter(name)
    _counters[name].add(value, attrs or {})


def record_histogram(name: str, value: float, attrs: dict | None = None) -> None:
    if not _enabled or _meter is None:
        return
    if name not in _histograms:
        _histograms[name] = _meter.create_histogram(name)
    _histograms[name].record(value, attrs or {})
