"""Phase 8 — audit best-effort test (never raises, even if DB down)."""
import app.observability.audit as audit_mod
from app.observability.audit import audit
from app.config import SETTINGS


def test_audit_never_raises(monkeypatch):
    # Force a database-connection failure → audit must swallow it (best-effort).
    monkeypatch.setattr(SETTINGS, "database_url", "postgresql+psycopg2://nope:nope@127.0.0.1:1/nope")
    audit("test_event", username="dev", domain="database", confidence=0.75, decision="answer")
    assert True  # reached → no exception propagated


def test_audit_module_exposes_fn():
    assert callable(audit_mod.audit)
