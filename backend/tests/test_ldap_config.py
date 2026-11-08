"""LDAP connection settings resolve from the database first, environment second.

The LDAP panel has always written `host` / `port` / `bind_dn` / `bind_password` /
`base_dn` / `user_filter` into `system_settings`, while the login path read
`SETTINGS.ldap_*` from the environment. That made the panel decorative: Test connection
passed (it uses the stored values) and every login still failed.

These tests pin the URL normaliser, which is where the two-field UI meets ldap3.
"""
from __future__ import annotations

import pytest

from fastapi import HTTPException

from app.api.settings import validate_ldap_payload
from app.auth.ldap_auth import _build_url


@pytest.mark.parametrize(
    ("host", "port", "expected"),
    [
        ("10.10.10.10", "636", "ldaps://10.10.10.10:636"),
        ("10.10.10.10", 389, "ldap://10.10.10.10:389"),
        ("ad.corp.local", "", "ldap://ad.corp.local:389"),
        ("ad.corp.local", None, "ldap://ad.corp.local:389"),
        ("ldaps://ad.corp.local", "", "ldaps://ad.corp.local:636"),
        ("ldap://ad.corp.local:3268", "", "ldap://ad.corp.local:3268"),
        ("ldaps://ad.corp.local:636", "999", "ldaps://ad.corp.local:636"),
        ("  ad.corp.local/  ", "636", "ldaps://ad.corp.local:636"),
        ("", "636", ""),
    ],
)
def test_build_url(host, port, expected):
    assert _build_url(host, port) == expected


def test_filter_must_reference_username():
    with pytest.raises(HTTPException) as exc:
        validate_ldap_payload({"user_filter": "(sAMAccountName=svc)"})
    assert exc.value.status_code == 400
    assert "{username}" in exc.value.detail


def test_port_must_be_numeric():
    with pytest.raises(HTTPException) as exc:
        validate_ldap_payload({"port": "63x"})
    assert exc.value.status_code == 400


def test_valid_ldap_payload_is_trimmed():
    out = validate_ldap_payload({"port": " 636 ", "user_filter": "(uid={username})"})
    assert out["port"] == "636"


def test_empty_filter_and_port_mean_keep():
    out = validate_ldap_payload({"port": "", "user_filter": "", "bind_password": "__CLEAR__"})
    assert out["port"] == "" and out["bind_password"] == "__CLEAR__"
