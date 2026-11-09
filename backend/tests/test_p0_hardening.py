"""P0 hardening regressions: header injection, public API docs.

These do not need a database — they are pure functions and settings defaults.
"""
from __future__ import annotations

from app.api.tickets import _content_disposition, _safe_filename
from app.config import SETTINGS


class TestSafeFilename:
    def test_a_quote_cannot_close_the_header_early(self) -> None:
        assert '"' not in _safe_filename('report".pdf')

    def test_crlf_cannot_split_the_response(self) -> None:
        out = _safe_filename("a\r\nX-Injected: 1.txt")
        assert "\r" not in out and "\n" not in out

    def test_path_separators_are_removed(self) -> None:
        assert "/" not in _safe_filename("../../etc/passwd")
        assert "\\" not in _safe_filename("..\\..\\windows\\system32")

    def test_the_original_script_survives(self) -> None:
        assert _safe_filename("မြန်မာ အစီရင်ခံစာ.pdf") == "မြန်မာ အစီရင်ခံစာ.pdf"

    def test_an_empty_name_gets_a_fallback(self) -> None:
        assert _safe_filename(None) == "attachment"
        assert _safe_filename("   ") == "attachment"


class TestContentDisposition:
    def test_both_filenames_are_present(self) -> None:
        header = _content_disposition("q3 report.pdf")
        assert header.startswith("attachment;")
        assert 'filename="q3 report.pdf"' in header
        assert "filename*=UTF-8''q3%20report.pdf" in header

    def test_an_injected_name_cannot_add_a_header(self) -> None:
        header = _content_disposition('x"\r\nSet-Cookie: a=b')
        assert "\r" not in header and "\n" not in header
        assert header.count('"') == 2  # exactly the pair around the quoted filename

    def test_a_non_latin_name_keeps_a_usable_ascii_stem(self) -> None:
        header = _content_disposition("မြန်မာ.pdf")
        assert 'filename="attachment.pdf"' in header
        assert "filename*=UTF-8''%E1%80%99" in header

    def test_inline_is_available_for_preview(self) -> None:
        assert _content_disposition("a.png", inline=True).startswith("inline;")


def test_api_docs_are_off_by_default() -> None:
    """The interactive docs are a full map of the API; an internal deployment must opt in."""
    assert SETTINGS.api_docs_enabled is False
