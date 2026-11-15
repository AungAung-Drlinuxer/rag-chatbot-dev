"""Profile photos: the bytes decide the type, and the size cap is enforced."""

import pytest

from app.api.users import _AVATAR_MAX_BYTES, _sniff_image


def test_sniff_accepts_the_three_allowed_formats():
    assert _sniff_image(b"\x89PNG\r\n\x1a\n" + b"0" * 20) == "image/png"
    assert _sniff_image(b"\xff\xd8\xff\xe0" + b"0" * 20) == "image/jpeg"
    assert _sniff_image(b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"0" * 10) == "image/webp"


def test_sniff_rejects_anything_else():
    assert _sniff_image(b"GIF89a" + b"0" * 20) is None
    assert _sniff_image(b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>" ) is None
    assert _sniff_image(b"RIFF\x10\x00\x00\x00WAVE") is None  # RIFF, but not WebP


def test_upload_cap_is_small():
    assert _AVATAR_MAX_BYTES == 512 * 1024
