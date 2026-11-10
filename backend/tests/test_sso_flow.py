"""OIDC sign-in is verified against a real (fake) realm, not trusted blindly.

These tests stand up a stub identity provider in-process: a discovery document, a JWKS and a
token endpoint that returns an id_token signed with a throwaway RSA key. That is enough to
exercise every security-relevant step — state, PKCE, signature, issuer, audience, nonce,
expiry — without a Keycloak server.

The callback deliberately fails closed: a bad state, a tampered token or a mismatched nonce
sends the browser back to the login page with a reason, never into the app.
"""
from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jose import jwt

from app.auth import sso

ISSUER = "https://kc.test/realms/ith"
KID = "test-key"

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIVATE_PEM = _KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
).decode()
_PUBLIC_NUMBERS = _KEY.public_key().public_numbers()
import base64

JWKS = {
    "keys": [
        {
            "kty": "RSA",
            "kid": KID,
            "use": "sig",
            "alg": "RS256",
            "n": base64.urlsafe_b64encode(
                _PUBLIC_NUMBERS.n.to_bytes((_PUBLIC_NUMBERS.n.bit_length() + 7) // 8, "big")
            ).decode().rstrip("="),
            "e": base64.urlsafe_b64encode(
                _PUBLIC_NUMBERS.e.to_bytes((_PUBLIC_NUMBERS.e.bit_length() + 7) // 8, "big")
            ).decode().rstrip("="),
        }
    ]
}

DISCOVERY = {
    "issuer": ISSUER,
    "authorization_endpoint": f"{ISSUER}/protocol/openid-connect/auth",
    "token_endpoint": f"{ISSUER}/protocol/openid-connect/token",
    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
}

CFG = {
    "issuer": "https://kc.test",
    "realm": "ith",
    "client_id": "it-help-chatbot",
    "client_secret": "secret",
    "redirect_uri": "https://chat.test/auth/callback",
}


class _Resp:
    def __init__(self, payload: dict, status: int = 200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload)

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.text)


@pytest.fixture(autouse=True)
def fake_idp(monkeypatch):
    sso._STATES.clear()
    sso._CODES.clear()
    sso._DISCOVERY.clear()
    sso._JWKS.clear()
    monkeypatch.setattr(sso, "sso_cfg", lambda: dict(CFG))

    state = {"nonce": None}

    def fake_get(url, *a, **kw):
        if url.endswith("/.well-known/openid-configuration"):
            return _Resp(DISCOVERY)
        if url.endswith("/certs"):
            return _Resp(JWKS)
        raise AssertionError(f"unexpected GET {url}")

    def fake_post(url, data=None, *a, **kw):
        assert url == DISCOVERY["token_endpoint"]
        claims = {
            "iss": ISSUER,
            "aud": CFG["client_id"],
            "sub": "abc-123",
            "preferred_username": "aungaung",
            "email": "aungaung@corp.test",
            "groups": ["it-help-admins"],
            "nonce": state["nonce"],
        }
        token = jwt.encode(claims, _PRIVATE_PEM, algorithm="RS256", headers={"kid": KID})
        return _Resp({"id_token": token, "access_token": "opaque"})

    import httpx

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(httpx, "post", fake_post)
    return state


def _sign(claims: dict) -> str:
    return jwt.encode(claims, _PRIVATE_PEM, algorithm="RS256", headers={"kid": KID})


def _begin():
    url = sso.start_login()
    params = parse_qs(urlparse(url).query)
    sso._STATES[params["state"][0]]["nonce"]  # exists
    return url, params


def test_start_login_builds_a_pkce_authorize_request():
    url, params = _begin()
    assert url.startswith(DISCOVERY["authorization_endpoint"])
    assert params["response_type"] == ["code"]
    assert params["client_id"] == [CFG["client_id"]]
    assert params["code_challenge_method"] == ["S256"]
    assert params["redirect_uri"] == [CFG["redirect_uri"]]
    assert params["nonce"][0]


def test_full_exchange_yields_verified_claims(fake_idp):
    url, params = _begin()
    state = params["state"][0]
    fake_idp["nonce"] = sso._STATES[state]["nonce"]

    attempt = sso.take_state(state)
    tokens = sso.exchange_code("the-code", attempt["verifier"], attempt["redirect_uri"])
    claims = sso.verify_id_token(tokens["id_token"], attempt["nonce"])

    assert sso.username_from(claims) == "aungaung"
    assert sso.role_from_claims(claims) == "admin"


def test_state_is_single_use():
    _, params = _begin()
    sso.take_state(params["state"][0])
    with pytest.raises(ValueError):
        sso.take_state(params["state"][0])


def test_nonce_mismatch_is_rejected(fake_idp):
    _, params = _begin()
    fake_idp["nonce"] = "some-other-nonce"
    attempt = sso.take_state(params["state"][0])
    tokens = sso.exchange_code("c", attempt["verifier"], attempt["redirect_uri"])
    with pytest.raises(ValueError):
        sso.verify_id_token(tokens["id_token"], attempt["nonce"])


@pytest.mark.parametrize(
    "override",
    [
        {"aud": "another-client"},
        {"iss": "https://evil.test/realms/ith"},
        {"exp": 1_000_000_000},
    ],
)
def test_bad_id_token_claims_are_rejected(override):
    base = {
        "iss": ISSUER,
        "aud": CFG["client_id"],
        "sub": "abc",
        "preferred_username": "x",
        "nonce": "n",
    }
    base.update(override)
    with pytest.raises(ValueError):
        sso.verify_id_token(_sign(base), "n")


def test_one_time_code_roundtrip():
    code = sso.issue_code("aungaung")
    assert sso.redeem_code(code) == "aungaung"
    with pytest.raises(ValueError):
        sso.redeem_code(code)


def test_role_mapping_from_realm_roles_and_groups():
    assert sso.role_from_claims({"realm_access": {"roles": ["it-help-agents"]}}) == "knowledge"
    assert sso.role_from_claims({"groups": ["staff"]}) is None


def test_callback_and_exchange_move_the_spa_between_pages(fake_idp, monkeypatch):
    """End-to-end through the HTTP surface: login → callback → code → app tokens."""
    from app.api import auth as auth_api
    from app.main import app

    monkeypatch.setattr(auth_api, "audit", lambda *a, **k: None)
    monkeypatch.setattr(sso, "provision", lambda u, r: "ok")
    monkeypatch.setattr("app.auth.rbac.is_disabled", lambda u: False)
    from app.config import SETTINGS

    monkeypatch.setattr(SETTINGS, "jwt_secret", "test-signing-key", raising=False)

    client = TestClient(app, follow_redirects=False)

    first = client.get("/api/auth/sso/login")
    assert first.status_code == 302
    params = parse_qs(urlparse(first.headers["location"]).query)
    state = params["state"][0]
    fake_idp["nonce"] = sso._STATES[state]["nonce"]

    done = client.get(f"/api/auth/sso/callback?code=abc&state={state}")
    assert done.status_code == 302
    location = done.headers["location"]
    assert location.startswith("https://chat.test/#/sso?code=")
    code = parse_qs(urlparse(location).fragment.split("?", 1)[1])["code"][0]

    tokens = client.post("/api/auth/sso/exchange", json={"code": code})
    assert tokens.status_code == 200
    body = tokens.json()
    assert body["username"] == "aungaung" and body["access_token"]

    reused = client.post("/api/auth/sso/exchange", json={"code": code})
    assert reused.status_code == 401


def test_callback_with_unknown_state_returns_to_login():
    from app.main import app

    client = TestClient(app, follow_redirects=False)
    r = client.get("/api/auth/sso/callback?code=abc&state=not-a-state")
    assert r.status_code == 302
    assert "sso_error=failed" in r.headers["location"]


def test_sso_enabled_publishes_the_provider_without_secrets(monkeypatch):
    """The login page labels the button from this response.

    It may name the provider and the realm — both are already visible in the browser's
    redirect — but never the client secret.
    """
    from fastapi.testclient import TestClient

    import app.auth.sso as sso_mod
    from app.main import app

    monkeypatch.setattr(sso_mod, "enabled", lambda: True)
    monkeypatch.setattr(sso_mod, "sso_cfg", lambda: {
        "issuer": "https://kc.example/realms/ihkp",
        "realm": "ihkp",
        "client_id": "it-help",
        "client_secret": "do-not-leak",
        "redirect_uri": "https://dev-chat.example/api/auth/sso/callback",
    })

    body = TestClient(app).get("/api/auth/sso/enabled").json()
    assert body["enabled"] is True
    assert body["provider"] == "keycloak"
    assert body["label"] == "Keycloak"
    assert body["realm"] == "ihkp"
    assert "do-not-leak" not in str(body)
    assert "client_secret" not in body
