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
    token = create_refresh_token("jsmith")
    assert decode_token(token) == "jsmith"


def test_jwt_rejects_garbage():
    from jose import JWTError

    with pytest.raises(JWTError):
        decode_token("not-a-token")
