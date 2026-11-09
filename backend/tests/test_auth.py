"""Phase 5 auth unit tests — LDAP dev fallback + JWT (no network/LDAP needed)."""
import pytest

from app.auth.jwt import create_access_token, create_refresh_token, decode_token
from app.auth.ldap_auth import authenticate


def test_dev_login_ok():
    assert authenticate("dev", "dev") == "dev"


def test_dev_login_bad_password():
    assert authenticate("dev", "wrong") is None


def test_dev_login_unknown_user():
    assert authenticate("nobody", "dev") is None


def test_jwt_roundtrip():
    token = create_access_token("jsmith")
    assert decode_token(token) == "jsmith"


def test_jwt_refresh_token():
    # v0.18.1 — the `type` claim is enforced, so a refresh token must be decoded AS a
    # refresh token. Decoding it as an access token is exactly the replay this blocks.
    token = create_refresh_token("jsmith")
    assert decode_token(token, expected_type="refresh") == "jsmith"


def test_a_refresh_token_is_not_accepted_as_an_access_token():
    import pytest as _pytest

    token = create_refresh_token("jsmith")
    with _pytest.raises(ValueError):
        decode_token(token)


def test_jwt_rejects_garbage():
    from jose import JWTError

    with pytest.raises(JWTError):
        decode_token("not-a-token")
