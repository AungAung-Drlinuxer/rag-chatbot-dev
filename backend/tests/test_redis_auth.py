"""Redis connection strings must carry the password the deployment keeps beside them.

The regression: `REDIS_URL` is stored without credentials and `REDIS_PASSWORD` holds the
secret separately. `get_redis()` and `broker_url()` used the bare URL, so no AUTH was sent
and every call failed with "AuthenticationError: Authentication required" — the dashboard
health panel showed Redis Down while a manual `redis-cli -a <same password>` answered
PING. These tests pin the join, without needing a server.
"""
from app.config import SETTINGS
from app.persistence.redis import _with_password, broker_url, result_backend_url


def _set(monkeypatch, *, password: str, url: str, mode: str = "standalone"):
    monkeypatch.setattr(SETTINGS, "redis_mode", mode, raising=False)
    monkeypatch.setattr(SETTINGS, "redis_password", password, raising=False)
    monkeypatch.setattr(SETTINGS, "redis_url", url, raising=False)


def test_password_from_settings_is_added_to_the_url(monkeypatch):
    _set(monkeypatch, password="s3cret", url="redis://redis-service:6379/0")
    assert broker_url() == "redis://:s3cret@redis-service:6379/0"
    assert result_backend_url() == "redis://:s3cret@redis-service:6379/1"


def test_an_existing_password_in_the_url_is_not_duplicated(monkeypatch):
    _set(monkeypatch, password="s3cret", url="redis://:s3cret@redis-service:6379/0")
    assert _with_password(SETTINGS.redis_url) == "redis://:s3cret@redis-service:6379/0"
    assert broker_url().count("s3cret") == 1


def test_no_password_leaves_the_url_untouched(monkeypatch):
    _set(monkeypatch, password="", url="redis://redis-service:6379/0")
    assert _with_password(SETTINGS.redis_url) == "redis://redis-service:6379/0"


def test_special_characters_are_percent_encoded(monkeypatch):
    _set(monkeypatch, password="p@ss/word", url="redis://redis-service:6379/0")
    assert "@redis-service" in broker_url()
    assert "p%40ss%2Fword" in broker_url()


def test_the_password_never_leaks_into_the_path(monkeypatch):
    _set(monkeypatch, password="s3cret", url="redis://redis-service:6379/0")
    assert broker_url().endswith("/0")
    assert result_backend_url().endswith("/1")
