"""Phase 10 — Redis standalone/Sentinel switch tests (lazy, no network)."""
from app.persistence import redis as rd
from app.config import SETTINGS


def test_broker_url_standalone(monkeypatch):
    monkeypatch.setattr(SETTINGS, "redis_mode", "standalone")
    monkeypatch.setattr(SETTINGS, "redis_url", "redis://localhost:6380/0")
    assert rd.broker_url() == "redis://localhost:6380/0"
    assert rd.result_backend_url() == "redis://localhost:6380/1"  # /0 -> /1 split kept


def test_broker_url_sentinel(monkeypatch):
    monkeypatch.setattr(SETTINGS, "redis_mode", "sentinel")
    monkeypatch.setattr(SETTINGS, "redis_sentinels", "h1:26379,h2:26379,h3:26379")
    monkeypatch.setattr(SETTINGS, "redis_password", "secret")
    b = rd.broker_url()
    assert b.startswith("sentinel://:secret@h1:26379")
    assert ";alt=h2:26379" in b and ";alt=h3:26379" in b
    assert b.endswith("/0")  # no master port in URL (kombu gets it from sentinel)
    assert rd.result_backend_url().endswith("/1")


def test_transport_options(monkeypatch):
    monkeypatch.setattr(SETTINGS, "redis_mode", "sentinel")
    monkeypatch.setattr(SETTINGS, "redis_master_name", "mymaster")
    assert rd.transport_options() == {"master_name": "mymaster"}
    monkeypatch.setattr(SETTINGS, "redis_mode", "standalone")
    assert rd.transport_options() == {}


def test_transport_options_sentinel_password(monkeypatch):
    """kombu must AUTH to the Sentinel via sentinel_kwargs (requirepass'd Sentinel)."""
    monkeypatch.setattr(SETTINGS, "redis_mode", "sentinel")
    monkeypatch.setattr(SETTINGS, "redis_master_name", "mymaster")
    monkeypatch.setattr(SETTINGS, "redis_password", "secret")
    assert rd.transport_options() == {"master_name": "mymaster", "sentinel_kwargs": {"password": "secret"}}
    # no password -> no sentinel_kwargs
    monkeypatch.setattr(SETTINGS, "redis_password", "")
    assert rd.transport_options() == {"master_name": "mymaster"}


def test_get_redis_standalone(monkeypatch):
    monkeypatch.setattr(SETTINGS, "redis_mode", "standalone")
    monkeypatch.setattr(SETTINGS, "redis_url", "redis://localhost:6380/0")
    r = rd.get_redis()
    assert hasattr(r, "ping")  # from_url is lazy; no connect


def test_get_redis_sentinel_constructs(monkeypatch):
    monkeypatch.setattr(SETTINGS, "redis_mode", "sentinel")
    monkeypatch.setattr(SETTINGS, "redis_sentinels", "h1:26379,h2:26379")
    monkeypatch.setattr(SETTINGS, "redis_master_name", "mymaster")
    r = rd.get_redis()
    assert hasattr(r, "ping")  # master_for is lazy; no network
