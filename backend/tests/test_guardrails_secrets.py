"""Guardrail behaviour: what must be caught, and what must not be.

The miss that prompted this file: `sk_c6a3…` (underscore) sailed straight through and
the assistant answered it as a normal question, because the old pattern only knew `sk-`.
"""
from __future__ import annotations

import pytest

from app.security.guardrails import check_input

# Assembled at runtime so no credential-shaped string is committed verbatim.
LONG_KEY = "sk-test-REDACTED-fixture"


@pytest.mark.parametrize(
    "text,expected",
    [
        # --- secrets the old list missed -------------------------------------
        (LONG_KEY, "pii"),
        ("here is my key sk-proj-abcdefghijklmnopqrstuvwxyz012345", "pii"),
        ("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", "pii"),
        ("xoxb-123456789012-abcdefghijkl", "pii"),
        ("AKIAIOSFODNN7EXAMPLE", "pii"),
        ("AIzaSyD-1234567890abcdefghijklmnopqrstu", "pii"),
        ("Authorization: Bearer eyJhbGciOi.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4", "pii"),
        ("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...", "pii"),
        ("postgresql://app:s3cretpass@db.internal:5432/assistant", "pii"),
        ("Basic YWRtaW46aHVudGVyMnBhc3N3b3Jk", "pii"),
        ("openai_key = sk-test-REDACTED-fixture", "pii"),
        # --- existing identifiers --------------------------------------------
        ("my ssn is 123-45-6789", "pii"),
        ("card 4111 1111 1111 1111", "pii"),
        # --- must still pass (no false positives) ----------------------------
        ("how do I fix a VPN connection failure?", "pass"),
        ("commit 3f786850e387550fdab836ed7e6dc881de23001b fails", "pass"),
        ("session 550e8400-e29b-41d4-a716-446655440000 expired", "pass"),
        ("sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "pass"),
        ("customer ID 12345678901234567890", "pass"),
        ("please reset my password", "pass"),
        ("what is asset list status", "pass"),
    ],
)
def test_pii_matrix(text: str, expected: str) -> None:
    verdict = check_input(text)
    if expected == "pii":
        assert verdict.action == "blocked" and verdict.type == "pii", (
            f"{verdict.action}/{verdict.type}: {verdict.reason}")
    else:
        assert verdict.action == "pass", f"{verdict.type}: {verdict.reason}"


def test_short_id_like_strings_are_not_tokens() -> None:
    # 30 characters is below the entropy threshold and carries no vendor prefix.
    assert check_input("order ref 8f2c1d9e4b7a6c5d3e2f1a0b9c8d7e").action == "pass"


def test_refusal_does_not_quote_the_secret() -> None:
    from app.security.refusals import refusal_for

    text = refusal_for("pii")
    assert LONG_KEY not in text
    assert "sk_" not in text
