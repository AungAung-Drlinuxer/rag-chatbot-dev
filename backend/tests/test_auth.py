"""Auth contract: local credentials, the `unknown:` sentinel, and JWT round trips.

WHAT CHANGED: an "APP_ENV=dev, any password works" bypass used to exist. It was removed
because it let any username at all sign in on a dev deployment — the fix was to require a
real credential row (set by an administrator, or seeded by install.sh) and to answer
`unknown:<user>` for an account that exists nowhere, so the login screen can tell a typo
apart from a wrong password.
"""
from __future__ import annotations

import hashlib
import hmac
import uuid

import pytest

from app.auth.jwt import create_access_token, create_refresh_token, decode_token
from app.auth.ldap_auth import authenticate


@pytest.fixture()
def seeded_user():
    """A local account with a known password, removed afterwards."""
    from sqlalchemy import text as _sql

    from app.persistence.database import SessionLocal

    username = f"auth.probe.{uuid.uuid4().hex[:6]}"
    password = "Correct-Horse-1"
    salt = uuid.uuid4().hex
    digest = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    with SessionLocal() as s:
        s.execute(
            _sql(
                "INSERT INTO users (username, status, role_override) VALUES (:u, 'Active', 'user') "
                "ON CONFLICT (username) DO NOTHING"
            ),
            {"u": username},
        )
        s.execute(
            _sql(
                "INSERT INTO local_user_credentials (username, password_hash, source) "
                "VALUES (:u, :h, 'admin') "
                "ON CONFLICT (username) DO UPDATE SET password_hash = :h"
            ),
            {"u": username, "h": f"{salt}${digest}"},
        )
        s.commit()
    try:
        yield username, password
    finally:
        with SessionLocal() as s:
            s.execute(_sql("DELETE FROM local_user_credentials WHERE username = :u"), {"u": username})
            s.execute(_sql("DELETE FROM users WHERE username = :u"), {"u": username})
            s.commit()


def test_a_local_credential_authenticates(seeded_user):
    username, password = seeded_user
    assert authenticate(username, password) == username


def test_a_wrong_password_is_refused(seeded_user):
    username, _ = seeded_user
    assert authenticate(username, "wrong") is None


def test_an_unknown_account_is_named_as_unknown():
    """Not None: the login screen has to distinguish "no such account" from "wrong
    password", and the caller reads the `unknown:` prefix."""
    result = authenticate("definitely-not-a-person", "whatever")
    assert result is not None and result.startswith("unknown:")


def test_jwt_roundtrip():
    token = create_access_token("jsmith")
    assert decode_token(token) == "jsmith"


def test_jwt_refresh_token():
    # The `type` claim is enforced, so a refresh token must be decoded AS a refresh token.
    # Decoding it as an access token is exactly the replay this blocks.
    token = create_refresh_token("jsmith")
    assert decode_token(token, expected_type="refresh") == "jsmith"


def test_a_refresh_token_is_not_accepted_as_an_access_token():
    token = create_refresh_token("jsmith")
    with pytest.raises(ValueError):
        decode_token(token)


def test_jwt_rejects_garbage():
    from jose import JWTError

    with pytest.raises(JWTError):
        decode_token("not-a-token")
