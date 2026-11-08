"""Phase 7 ingest/loader unit tests — no DB, no Ollama (local file only)."""

from app.knowledge.ingest import _content_hash
from app.knowledge.loaders import load_fileshare


def test_content_hash_deterministic():
    assert _content_hash("Title", "body") == _content_hash("Title", "body")
    assert _content_hash("Title", "body") != _content_hash("Title", "different")


def test_load_fileshare(tmp_path):
    (tmp_path / "runbook.md").write_text("# Runbook\nsteps here", encoding="utf-8")
    (tmp_path / "notes.txt").write_text("some notes", encoding="utf-8")
    (tmp_path / "skip.bin").write_bytes(b"binary")
    arts = load_fileshare(str(tmp_path))
    titles = {a["title"] for a in arts}
    assert "runbook.md" in titles
    assert "notes.txt" in titles
    assert all(a["domain"] == "system" for a in arts)  # fileshare_domain default


def test_load_fileshare_missing_dir():
    assert load_fileshare("/no/such/dir") == []
