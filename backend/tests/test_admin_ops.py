"""`admin_ops` had no tests at all, and it is the module that hands out RBAC
permissions and approves escalations. The first thing to pin is the gate: a
non-admin must get 403 from every admin surface here, because these endpoints
manage who is an admin.
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
        # None of these are SQLAlchemy models — prod creates them out of band.
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS system_settings ("
            " key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT NOW())"
        ))
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS rbac_matrix ("
            " role TEXT PRIMARY KEY, permissions JSONB,"
            " updated_by TEXT, updated_at TIMESTAMPTZ)"
        ))
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS approvals ("
            " id TEXT PRIMARY KEY, username TEXT, question TEXT,"
            " status TEXT, created_at TIMESTAMPTZ DEFAULT NOW())"
        ))
    with TestClient(app) as c:
        yield c


_SID = "00000000-0000-4000-8000-000000000000"   # session_id is a uuid column


def _admin() -> dict:
    """The username `dev_admin_usernames` actually promotes (config default 'ith@dmin'),
    read from settings so the test cannot drift from the config."""
    from app.config import SETTINGS

    names = [u.strip() for u in (SETTINGS.dev_admin_usernames or "").split(",") if u.strip()]
    assert names, "dev_admin_usernames is empty — no admin identity available in tests"
    return {"Authorization": f"Bearer {create_access_token(names[0])}"}


def _plain_user() -> dict:
    """A username with no admin group membership and no role_override row."""
    return {"Authorization": f"Bearer {create_access_token('__ops_plain_user__')}"}


# --------------------------------------------------------------------------- #
# the gate
# --------------------------------------------------------------------------- #

ADMIN_ONLY = [
    # NOTE: GET /api/rbac/matrix is deliberately NOT here — it serves a read-only
    # copy to non-admins (the `editable` flag gates the write). Covered separately.
    ("get", "/api/users/someone/permissions"),
    ("get", "/api/runtime"),
    ("get", "/api/approvals"),
    ("get", "/api/admin/audits"),
    ("get", "/api/admin/audits/export"),
    ("get", "/api/admin/conversations"),
]

# these need a row that exists; an admin legitimately gets 404 for a missing id
ADMIN_ONLY_MISSING_ROW = [
    ("get", f"/api/admin/conversations/{_SID}/messages"),
    ("get", f"/api/admin/conversations/{_SID}/export"),
]


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_admin_surface_rejects_a_plain_user(client, method, path):
    r = getattr(client, method)(path, headers=_plain_user())
    assert r.status_code == 403, f"{method.upper()} {path} leaked to a non-admin: {r.status_code}"


@pytest.mark.parametrize("method,path", ADMIN_ONLY + ADMIN_ONLY_MISSING_ROW)
def test_admin_surface_rejects_anonymous(client, method, path):
    r = getattr(client, method)(path)
    assert r.status_code in (401, 403), f"{method.upper()} {path} answered {r.status_code} unauthenticated"


@pytest.mark.parametrize("method,path", ADMIN_ONLY)
def test_admin_surface_admits_an_admin(client, method, path):
    r = getattr(client, method)(path, headers=_admin())
    assert r.status_code == 200, f"{method.upper()} {path} -> {r.status_code} {r.text[:160]}"


@pytest.mark.parametrize("method,path", ADMIN_ONLY_MISSING_ROW)
def test_admin_surface_reaches_the_handler_for_a_missing_row(client, method, path):
    """403/401 would mean the gate fired; 404 proves we got past it to the lookup."""
    r = getattr(client, method)(path, headers=_admin())
    assert r.status_code in (200, 404), (
        f"{method.upper()} {path} -> {r.status_code} {r.text[:160]}")


@pytest.mark.parametrize("method,path", ADMIN_ONLY_MISSING_ROW)
def test_missing_row_endpoints_reject_a_plain_user(client, method, path):
    r = getattr(client, method)(path, headers=_plain_user())
    assert r.status_code == 403, f"{method.upper()} {path} leaked: {r.status_code}"


# --------------------------------------------------------------------------- #
# the RBAC matrix — the thing the gate itself is built from
# --------------------------------------------------------------------------- #

def _matrix(client, headers) -> dict:
    """GET /api/rbac/matrix returns {"matrix": [ {role, permissions, ...} ], "editable": bool}."""
    r = client.get("/api/rbac/matrix", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["matrix"], list), body
    return {row["role"]: row for row in body["matrix"]}


def test_rbac_matrix_is_readable_by_a_plain_user_but_not_editable(client):
    """Documented behaviour: non-admins get a read-only copy; `editable` is the gate."""
    plain = client.get("/api/rbac/matrix", headers=_plain_user())
    assert plain.status_code == 200, plain.text
    assert plain.json()["editable"] is False, "a plain user was offered the editable matrix"

    admin = client.get("/api/rbac/matrix", headers=_admin())
    assert admin.json()["editable"] is True


def test_rbac_matrix_round_trips(client):
    before = _matrix(client, _admin())
    # 'Administrator' is hard-guaranteed by the handler, so exercise a normal role
    role = next(r for r in before if r != "Administrator")
    caps = dict(before[role]["permissions"])
    if not caps:
        pytest.skip("matrix has no capabilities to round-trip")
    cap = next(iter(caps))
    original = caps[cap]

    def put(permissions: dict) -> None:
        r = client.put("/api/rbac/matrix", headers=_admin(),
                       json={"matrix": [{"role": role, "permissions": permissions}]})
        assert r.status_code == 200, r.text

    try:
        put({**caps, cap: not original})
        assert _matrix(client, _admin())[role]["permissions"][cap] == (not original), (
            f"{role}.{cap} did not persist")
    finally:
        put({**caps, cap: original})

    assert _matrix(client, _admin())[role]["permissions"][cap] == original, "restore failed"


def test_administrator_row_cannot_be_downgraded(client):
    """The handler must ignore an attempt to strip the admin role's permissions."""
    before = _matrix(client, _admin())
    caps = dict(before["Administrator"]["permissions"])

    r = client.put("/api/rbac/matrix", headers=_admin(),
                   json={"matrix": [{"role": "Administrator", "permissions": {k: False for k in caps}}]})
    assert r.status_code == 200, r.text

    after = _matrix(client, _admin())["Administrator"]["permissions"]
    assert all(after[k] for k in caps), f"admin lost permissions: {after}"


def test_rbac_matrix_put_rejects_a_plain_user(client):
    r = client.put("/api/rbac/matrix", headers=_plain_user(), json={"matrix": {}})
    assert r.status_code == 403


# --------------------------------------------------------------------------- #
# response shapes the SPA reads
# --------------------------------------------------------------------------- #

def test_runtime_settings_shape(client):
    r = client.get("/api/runtime", headers=_admin())
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict) and body, "runtime settings came back empty"


def test_runtime_put_round_trips_a_known_key(client):
    before = client.get("/api/runtime", headers=_admin()).json()
    key = "confidence_gate_threshold" if "confidence_gate_threshold" in before else next(iter(before))
    original = before[key]
    if not isinstance(original, (int, float)):
        pytest.skip(f"{key} is not numeric; nothing safe to round-trip")

    try:
        r = client.put("/api/runtime", headers=_admin(), json={key: 0.42})
        assert r.status_code == 200, r.text
        assert client.get("/api/runtime", headers=_admin()).json()[key] == 0.42
    finally:
        client.put("/api/runtime", headers=_admin(), json={key: original})

    assert client.get("/api/runtime", headers=_admin()).json()[key] == original


def test_approvals_shape(client):
    r = client.get("/api/approvals", headers=_admin())
    assert r.status_code == 200, r.text
    body = r.json()
    assert "approvals" in body, body
    assert isinstance(body["approvals"], list), body


def test_audits_export_is_a_download_not_json(client):
    r = client.get("/api/admin/audits/export", headers=_admin())
    assert r.status_code == 200, r.text
    ctype = r.headers.get("content-type", "")
    assert "json" not in ctype or "attachment" in r.headers.get("content-disposition", ""), (
        f"export returned {ctype}; an export endpoint should offer a file"
    )


def test_unknown_permission_user_is_404_or_empty_not_500(client):
    r = client.get("/api/users/__nobody__/permissions", headers=_admin())
    assert r.status_code in (200, 404), r.status_code
    if r.status_code == 200:
        assert isinstance(r.json(), dict)
