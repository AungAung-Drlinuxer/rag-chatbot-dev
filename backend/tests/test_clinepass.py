"""ClinePass provider wiring — routing and catalogue handling (no network).

Why these exist: the live DB held `provider: "ClinePass"` while `make_chain()`
only recognised a fixed allow-list and sent everything else to the Anthropic
SDK, so every request failed over to the local model. These tests pin the
routing rule and the ClinePass-specific model catalogue.
"""
from __future__ import annotations

import pytest

from app.llm import client as llm_mod


@pytest.fixture()
def stub_builders(monkeypatch):
    monkeypatch.setattr(llm_mod, "_build_openai", lambda: "OPENAI_CLIENT")
    monkeypatch.setattr(llm_mod, "_build_anthropic", lambda: "ANTHROPIC_CLIENT")


def _cfg_with(monkeypatch, **values):
    def fake_cfg(key: str, default: str = "") -> str:
        return str(values.get(key, default))

    monkeypatch.setattr(llm_mod, "_cfg", fake_cfg)


def test_clinepass_routes_to_openai(monkeypatch, stub_builders):
    _cfg_with(monkeypatch, provider="ClinePass", api_key="k", base_url="https://api.cline.bot/api/v1")
    assert llm_mod.make_chain() == "OPENAI_CLIENT"


def test_clinepass_lowercase_alias_routes_to_openai(monkeypatch, stub_builders):
    _cfg_with(monkeypatch, provider="cline-pass", api_key="k")
    assert llm_mod.make_chain() == "OPENAI_CLIENT"


def test_anthropic_still_routes_to_anthropic(monkeypatch, stub_builders):
    _cfg_with(monkeypatch, provider="anthropic", api_key="k")
    assert llm_mod.make_chain() == "ANTHROPIC_CLIENT"


def test_unknown_provider_defaults_to_openai(monkeypatch, stub_builders):
    # A gateway the code has never heard of is far more likely to be
    # OpenAI-compatible than Claude-compatible.
    _cfg_with(monkeypatch, provider="my-onprem-gateway", api_key="k")
    assert llm_mod.make_chain() == "OPENAI_CLIENT"


def test_no_key_returns_none(monkeypatch, stub_builders):
    _cfg_with(monkeypatch, provider="clinepass", api_key="")
    assert llm_mod.make_chain() is None


# --- settings-side helpers -------------------------------------------------

from app.api import settings as settings_api


def test_is_clinepass_by_provider_name():
    assert settings_api._is_clinepass({"provider": "ClinePass"})
    assert settings_api._is_clinepass({"provider": "cline-pass"})
    assert settings_api._is_clinepass({"provider": "cline"})


def test_is_clinepass_by_base_url_host():
    assert settings_api._is_clinepass({"provider": "custom",
                                       "base_url": "https://api.cline.bot/api/v1"})
    assert not settings_api._is_clinepass({"provider": "openrouter",
                                           "base_url": "https://openrouter.ai/api/v1"})


def test_clinepass_catalog_parses_recommended_feed(monkeypatch):
    payload = {
        "recommended": [{"id": "anthropic/claude-sonnet-5.5"}],
        "clinePass": [
            {"id": "cline-pass/deepseek-v4.1-flash", "name": "cline-pass/deepseek-v4.1-flash"},
            {"id": "cline-pass/glm-5.3", "name": "GLM 5.3"},
            {"name": "no id — must be skipped"},
        ],
    }

    class _Resp:
        status_code = 200

        @staticmethod
        def json():
            return payload

    class _Httpx:
        @staticmethod
        def get(*_a, **_k):
            return _Resp()

    monkeypatch.setitem(__import__("sys").modules, "httpx", _Httpx)

    out = settings_api._clinepass_catalog()
    assert out == [
        {"id": "cline-pass/deepseek-v4.1-flash", "name": "cline-pass/deepseek-v4.1-flash"},
        {"id": "cline-pass/glm-5.3", "name": "GLM 5.3"},
    ]


def test_clinepass_catalog_returns_none_on_error(monkeypatch):
    class _Httpx:
        @staticmethod
        def get(*_a, **_k):
            raise RuntimeError("boom")

    monkeypatch.setitem(__import__("sys").modules, "httpx", _Httpx)
    assert settings_api._clinepass_catalog() is None
