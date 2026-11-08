"""JSM settings are validated at save time, not at ticket time.

A wrong request-type id is silent: escalation falls back to a plain Task and the ticket
still exists, so nothing looks broken until someone notices the request never reached the
service desk. These tests pin the validation that prevents that.
"""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.api.settings import validate_confluence_payload, validate_jira_payload

EMAIL = "ops@example.com"


def test_numeric_service_desk_is_kept_as_string():
    out = validate_jira_payload({"service_desk_id": " 12 ", "base_url": "https://x.atlassian.net",
                                 "email": EMAIL})
    assert out["service_desk_id"] == "12"
    assert out["base_url"] == "https://x.atlassian.net"


def test_non_numeric_service_desk_is_rejected():
    with pytest.raises(HTTPException) as exc:
        validate_jira_payload({"service_desk_id": "12abc"})
    assert exc.value.status_code == 400
    assert "numeric" in exc.value.detail


def test_request_types_json_is_normalised():
    out = validate_jira_payload({"request_types": '{"Server": "101", "NETWORK": "102"}'})
    assert json.loads(out["request_types"]) == {"server": "101", "network": "102"}


def test_request_types_accepts_a_dict():
    out = validate_jira_payload({"request_types": {"general": 100}})
    assert json.loads(out["request_types"]) == {"general": "100"}


@pytest.mark.parametrize("bad", ["not json", "[]", "{}", '{"server": "abc"}', '{"server": ""}'])
def test_request_types_rejects_bad_shapes(bad):
    with pytest.raises(HTTPException) as exc:
        validate_jira_payload({"request_types": bad})
    assert exc.value.status_code == 400


def test_empty_values_mean_keep_and_clear_passes_through():
    # "" means "keep the stored value"; "__CLEAR__" is the explicit delete sentinel. Neither
    # is a validation error — they are handled by the credential policy.
    out = validate_jira_payload({"service_desk_id": "", "request_types": "", "api_token": "__CLEAR__"})
    assert out["service_desk_id"] == ""
    assert out["api_token"] == "__CLEAR__"


# ---------------------------------------------------------------------------
# Atlassian Basic auth needs the account email, not just the token.
#
# Saving the token without the email used to succeed, and the runtime then paired the token
# with the email from the environment — a different Atlassian account — so every call came
# back 403 while the panel looked configured. These pin the refusal at save time.
# ---------------------------------------------------------------------------


def test_jira_requires_the_account_email_when_configuring():
    with pytest.raises(HTTPException) as exc:
        validate_jira_payload({"base_url": "https://x.atlassian.net", "api_token": "t"})
    assert exc.value.status_code == 400
    assert "account email" in exc.value.detail


def test_jira_rejects_a_malformed_email():
    with pytest.raises(HTTPException) as exc:
        validate_jira_payload({"base_url": "https://x.atlassian.net", "email": "not-an-email"})
    assert exc.value.status_code == 400
    assert "not an email" in exc.value.detail


def test_jira_accepts_a_normal_save_with_email():
    out = validate_jira_payload({"base_url": "https://x.atlassian.net", "email": EMAIL,
                                 "project_key": "ITHD"})
    assert out["email"] == EMAIL


def test_confluence_requires_the_account_email_when_configuring():
    with pytest.raises(HTTPException) as exc:
        validate_confluence_payload({"base_url": "https://x.atlassian.net/wiki", "api_token": "t"})
    assert exc.value.status_code == 400
    assert "Confluence" in exc.value.detail


def test_confluence_allows_partial_payloads_that_are_not_configuring():
    # An update that only touches space keys must not demand the email again.
    out = validate_confluence_payload({"space_keys": "IHKB"})
    assert out["space_keys"] == "IHKB"
