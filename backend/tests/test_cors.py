"""Phase 10 — CORS test: the web/dev frontend origin must be allowed (found by login E2E test)."""
from fastapi.testclient import TestClient

from app.main import app


def test_cors_allows_frontend_origin():
    with TestClient(app) as client:
        r = client.get("/health", headers={"Origin": "http://127.0.0.1:4173"})
        assert r.headers.get("access-control-allow-origin") == "http://127.0.0.1:4173"


def test_cors_allows_tauri_origin():
    with TestClient(app) as client:
        r = client.get("/health", headers={"Origin": "tauri://localhost"})
        assert r.headers.get("access-control-allow-origin") == "tauri://localhost"


def test_cors_preflight():
    with TestClient(app) as client:
        r = client.options("/api/auth/login", headers={
            "Origin": "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "http://127.0.0.1:4173"
