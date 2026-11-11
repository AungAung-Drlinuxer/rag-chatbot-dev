"""The brand name is configuration, not code.

Anything the app mails must name the workspace the administrator named — never a product
name compiled into the source. These tests pin the three things that went wrong before:
the name is read from system_settings, an unnamed install falls back to the neutral
default, and a broken branding row cannot break an email.
"""

from __future__ import annotations

import json

import pytest

from app import branding


class _FakeSession:
    def __init__(self, row):
        self._row = row

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *_a, **_k):
        row = self._row
        return type("R", (), {"first": lambda self_: row})()


def _patch_session(monkeypatch, value):
    row = (json.dumps(value),) if value is not None else None
    monkeypatch.setattr(
        "app.persistence.database.SessionLocal", lambda: _FakeSession(row), raising=True
    )


def test_uses_the_brand_name_an_admin_set(monkeypatch):
    _patch_session(monkeypatch, {"appName": "Drlinuxer Helpdesk"})
    assert branding.app_name() == "Drlinuxer Helpdesk"
    assert branding.mail_prefix() == "[Drlinuxer Helpdesk]"


def test_falls_back_to_the_neutral_default_when_unnamed(monkeypatch):
    _patch_session(monkeypatch, None)
    assert branding.app_name() == branding.DEFAULT_APP_NAME
    assert "iTH" not in branding.app_name()


def test_blank_name_is_not_a_name(monkeypatch):
    _patch_session(monkeypatch, {"appName": "   "})
    assert branding.app_name() == branding.DEFAULT_APP_NAME


def test_trims_and_caps(monkeypatch):
    _patch_session(monkeypatch, {"appName": "  " + "x" * 80 + "  "})
    assert branding.app_name() == "x" * 48


def test_a_broken_row_does_not_break_the_email(monkeypatch):
    class Boom:
        def __enter__(self):
            raise RuntimeError("db down")

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr("app.persistence.database.SessionLocal", lambda: Boom(), raising=True)
    assert branding.app_name() == branding.DEFAULT_APP_NAME


def test_no_hardcoded_product_name_in_outbound_subjects():
    from pathlib import Path

    root = Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        for line in text.splitlines():
            if '"Subject"' in line or "send_alert(" in line:
                if "iTH" in line:
                    offenders.append(f"{path.name}: {line.strip()}")
    assert offenders == [], f"hardcoded brand in outbound mail: {offenders}"
