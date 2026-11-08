"""Tests for Knowledge-tab endpoints (v0.4.0): domains/recent/list/sync-status."""
from sqlalchemy import text

from app.persistence.database import engine, init_db
from app.knowledge.ingest import ingest_article
from app.main import app


def _client():
    from fastapi.testclient import TestClient
    return TestClient(app)


def _seed():
    init_db()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM kb_meta"))
    ingest_article({"page_id": "kt-db-1", "title": "DB Timeout", "domain": "database",
                    "source_url": "http://x/db-1", "body": "Check pooler and pg_hba.",
                    "updated_by": "tester"})
    ingest_article({"page_id": "kt-net-1", "title": "VPN Steps", "domain": "network",
                    "source_url": "http://x/net-1", "body": "Reconnect client.",
                    "updated_by": "tester"})


def test_domains_and_recent():
    _seed()
    c = _client()
    tok = c.post("/api/auth/login", json={"username": "dev", "password": "dev"}).json()["access_token"]
    H = {"Authorization": f"Bearer {tok}"}

    r = c.get("/api/articles-domains", headers=H)
    assert r.status_code == 200
    doms = {d["domain"]: d["pages"] for d in r.json()["domains"]}
    assert doms.get("database") == 1 and doms.get("network") == 1

    r2 = c.get("/api/articles-recent?limit=5", headers=H)
    assert r2.status_code == 200
    arts = r2.json()["articles"]
    assert len(arts) >= 2 and arts[0]["title"] in {"DB Timeout", "VPN Steps"}


def test_list_filters_by_domain():
    _seed()
    c = _client()
    tok = c.post("/api/auth/login", json={"username": "dev", "password": "dev"}).json()["access_token"]
    r = c.get("/api/articles-list", params={"domain": "database"}, headers={"Authorization": f"Bearer {tok}"})
    arts = r.json()["articles"]
    assert arts and all(a["domain"] == "database" for a in arts)
    assert any(a["title"] == "DB Timeout" for a in arts)


def test_sync_status():
    _seed()
    from app.knowledge.ingest import sync_all
    sync_all(updated_by="tester")
    c = _client()
    tok = c.post("/api/auth/login", json={"username": "dev", "password": "dev"}).json()["access_token"]
    r = c.get("/api/sync-status", headers={"Authorization": f"Bearer {tok}"})
    body = r.json()
    assert body["pages"] >= 2
    assert body["healthy"] and "inserted" in body["last_run"]
