"""`domain_rename` had no tests at all, and it is the one endpoint that rewrites
primary data in three stores at once. These pin the guards and prove the cascade
is atomic: either all three stores move to the new key, or none do.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.auth.jwt import create_access_token


@pytest.fixture(scope="module")
def client():
    from app.main import app
    from app.persistence.database import engine, init_db

    init_db()
    with engine.begin() as conn:
        # not SQLAlchemy models — prod creates them out of band
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS system_settings ("
            " key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())"
        ))
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS kb_meta ("
            " page_id TEXT PRIMARY KEY, domain TEXT, title TEXT)"
        ))
        # langchain_pg_embedding is created by the pgvector integration, not by
        # init_db — create it here only if this database has never seen one.
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS langchain_pg_embedding ("
            " uuid uuid PRIMARY KEY DEFAULT gen_random_uuid(),"
            " custom_id varchar, cmetadata json)"
        ))
    with TestClient(app) as c:
        yield c


def _admin_headers() -> dict:
    """Read the promoted username from settings instead of hardcoding it."""
    from app.config import SETTINGS

    names = [u.strip() for u in (SETTINGS.dev_admin_usernames or "").split(",") if u.strip()]
    assert names, "dev_admin_usernames is empty — no admin identity available in tests"
    return {"Authorization": f"Bearer {create_access_token(names[0])}"}


def _mk_domain(key: str) -> int:
    from app.persistence.database import SessionLocal
    from app.persistence.models import ClassifierDomain

    with SessionLocal() as s:
        existing = s.query(ClassifierDomain).filter(ClassifierDomain.domain_key == key).first()
        if existing:
            return existing.id
        d = ClassifierDomain(domain_key=key, display_name=key.title())
        s.add(d)
        s.commit()
        s.refresh(d)
        return d.id


def _cleanup(keys: list[str]) -> None:
    """Remove every key a test could have created — including RENAME TARGETS.

    A leftover row here is not cosmetic: `get_active_keyword_rules()` replaces the
    built-in defaults wholesale once ANY row exists, so one stray domain with no
    keywords silently disables classification for every built-in domain and breaks
    unrelated tests (test_mvp.py::test_classifier_detects_database). Delete by
    prefix as well as by explicit key so a half-finished test cannot leak.
    """
    from app.persistence.database import SessionLocal
    from app.persistence.models import ClassifierDomain

    with SessionLocal() as s:
        s.query(ClassifierDomain).filter(
            ClassifierDomain.domain_key.in_(keys)
            | ClassifierDomain.domain_key.like("dren-%")
        ).delete(synchronize_session=False)
        s.commit()
    with SessionLocal() as s:
        s.execute(text("DELETE FROM kb_meta WHERE domain = ANY(:k) OR domain LIKE 'dren-%'"),
                  {"k": keys})
        s.execute(text(
            "DELETE FROM langchain_pg_embedding "
            "WHERE cmetadata->>'domain' = ANY(:k) OR cmetadata->>'domain' LIKE 'dren-%'"
        ), {"k": keys})
        s.commit()

    # `reload_rules_cache()` (called by the rename handler) replaces the in-memory
    # rule set WHOLESALE from the DB and caches it for 300s — so a rename poisons
    # the classifier cache for the rest of the process with dren-* keys and no
    # built-in domains. Worse, `get_active_keyword_rules()` does NOT fall back to
    # DEFAULT_KEYWORD_RULES once the DB is empty again: it only resets when
    # `_cached_rules` is already falsy. Restore the process state explicitly.
    from app.classifier import engine as _engine

    _engine._cached_rules = dict(_engine.DEFAULT_KEYWORD_RULES)
    _engine._last_loaded = 0.0


def _seed_stores(domain: str, n_pages: int = 3) -> None:
    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        for i in range(n_pages):
            s.execute(
                text("INSERT INTO kb_meta (page_id, content_hash, domain, title) "
                     "VALUES (:p, :h, :d, :t) "
                     "ON CONFLICT (page_id) DO UPDATE SET domain = :d"),
                {"p": f"pg-{domain}-{i}", "h": f"hash-{domain}-{i}", "d": domain, "t": f"page {i}"},
            )
            # real pgvector table: PK is `uuid`, cmetadata is json
            s.execute(
                text("INSERT INTO langchain_pg_embedding (uuid, custom_id, cmetadata) "
                     "VALUES (gen_random_uuid(), :i, json_build_object('domain', :d)::json)"),
                {"i": f"emb-{domain}-{i}", "d": domain},
            )
        s.commit()


# --------------------------------------------------------------------------- #
# validation — no DB writes should happen for any of these
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("bad", ["A", "x", "x" * 65, ""])
def test_key_outside_the_field_bounds_is_422(client, bad):
    """Pydantic Field(min_length=2, max_length=64) — rejected before the handler runs."""
    did = _mk_domain("dren-valid")
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": bad})
        assert r.status_code == 422, f"'{bad}' should fail the Field bounds, got {r.status_code}"
    finally:
        _cleanup(["dren-valid"])


@pytest.mark.parametrize("bad", ["has space", "-leading", "bad!char", "a.b", "a@b"])
def test_key_failing_the_handler_pattern_is_400(client, bad):
    """Inside the Field bounds but not [a-z0-9][a-z0-9_-]{1,63} -> the handler's 400."""
    did = _mk_domain("dren-pat")
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": bad})
        assert r.status_code == 400, f"'{bad}' should be a 400 from the pattern, got {r.status_code}"
        assert "lowercase letters" in r.json()["detail"]
    finally:
        _cleanup(["dren-pat"])


def test_uppercase_is_canonicalised_not_rejected(client):
    """The handler lowercases before validating, so 'DREN-NEW' lands as 'dren-new'."""
    did = _mk_domain("dren-case")
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "DREN-NEW"})
        assert r.status_code == 200, r.text
        assert r.json()["domain_key"] == "dren-new", "uppercase was not canonicalised"
        assert r.json()["old_domain_key"] == "dren-case"
    finally:
        _cleanup(["dren-case", "dren-new"])


def test_missing_domain_is_404(client):
    r = client.post("/api/admin/domains/99999999/rename",
                    headers=_admin_headers(), json={"new_domain_key": "whatever"})
    assert r.status_code == 404


def test_identical_key_is_rejected(client):
    did = _mk_domain("dren-same")
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "dren-same"})
        assert r.status_code == 400
        assert "identical" in r.json()["detail"].lower()
    finally:
        _cleanup(["dren-same"])


def test_collision_with_another_domain_is_rejected(client):
    a = _mk_domain("dren-a")
    _mk_domain("dren-b")
    try:
        r = client.post(f"/api/admin/domains/{a}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "dren-b"})
        assert r.status_code == 400
        assert "already exists" in r.json()["detail"]
    finally:
        _cleanup(["dren-a", "dren-b"])


# --------------------------------------------------------------------------- #
# the cascade
# --------------------------------------------------------------------------- #

def test_rename_migrates_all_three_stores(client):
    did = _mk_domain("dren-old")
    _seed_stores("dren-old", 3)
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "dren-new"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["old_domain_key"] == "dren-old"
        assert body["domain_key"] == "dren-new"
        assert body["kb_pages_migrated"] == 3

        from app.persistence.database import SessionLocal
        from app.persistence.models import ClassifierDomain

        with SessionLocal() as s:
            # 1. the classifier row
            assert s.query(ClassifierDomain).filter(
                ClassifierDomain.domain_key == "dren-new").count() == 1
            # 2. kb_meta
            n = s.execute(text("SELECT count(*) FROM kb_meta WHERE domain = 'dren-new'")).scalar()
            assert n == 3
            assert s.execute(text("SELECT count(*) FROM kb_meta WHERE domain = 'dren-old'")).scalar() == 0
            # 3. vector metadata
            n = s.execute(text(
                "SELECT count(*) FROM langchain_pg_embedding WHERE cmetadata->>'domain' = 'dren-new'"
            )).scalar()
            assert n == 3
            assert s.execute(text(
                "SELECT count(*) FROM langchain_pg_embedding WHERE cmetadata->>'domain' = 'dren-old'"
            )).scalar() == 0
    finally:
        _cleanup(["dren-old", "dren-new"])


def test_rename_is_refused_for_a_confluence_bound_key(client):
    """Renaming a Confluence-space-bound domain would silently break the loader."""
    from app.config import SETTINGS

    spaces = [s.strip().lower() for s in (SETTINGS.confluence_space_keys or "").split(",") if s.strip()]
    if not spaces:
        pytest.skip("no CONFLUENCE_SPACE_KEYS configured in this environment")
    bound = spaces[0]
    did = _mk_domain(bound)
    try:
        r = client.post(f"/api/admin/domains/{did}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "dren-freed"})
        assert r.status_code == 400
        assert "Confluence space key" in r.json()["detail"]
    finally:
        _cleanup([bound, "dren-freed"])


def test_failed_rename_leaves_every_store_untouched(client):
    """The collision guard must fire BEFORE any UPDATE — prove nothing moved."""
    a = _mk_domain("dren-keep-a")
    _mk_domain("dren-keep-b")
    _seed_stores("dren-keep-a", 2)
    try:
        r = client.post(f"/api/admin/domains/{a}/rename",
                        headers=_admin_headers(), json={"new_domain_key": "dren-keep-b"})
        assert r.status_code == 400

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            assert s.execute(text(
                "SELECT count(*) FROM kb_meta WHERE domain = 'dren-keep-a'"
            )).scalar() == 2, "kb_meta was written despite the guard"
            assert s.execute(text(
                "SELECT count(*) FROM langchain_pg_embedding "
                "WHERE cmetadata->>'domain' = 'dren-keep-a'"
            )).scalar() == 2, "vector metadata was written despite the guard"
    finally:
        _cleanup(["dren-keep-a", "dren-keep-b"])
