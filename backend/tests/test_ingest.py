"""Phase 7 ingest/loader unit tests — no DB, no Ollama (local file only)."""

from app.knowledge import ingest
from app.knowledge.ingest import _content_hash, _orphan_ids, _prune_orphans
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


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return [(r,) for r in self._rows]


class _Session:
    """Minimal SessionLocal stand-in: records deletes, answers the page_id query."""

    def __init__(self, known):
        self.known = known
        self.deleted: list[str] = []
        self.committed = False

    def execute(self, statement, params=None):
        if params and "p" in params:
            self.deleted.append(params["p"])
            return _Result([])
        return _Result(self.known)

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _wire(monkeypatch, known):
    session = _Session(known)
    deleted_vectors: list[str] = []
    monkeypatch.setattr(ingest, "SessionLocal", lambda: session)
    monkeypatch.setattr(ingest, "_delete_vectors", deleted_vectors.append)
    return session, deleted_vectors


def test_orphan_ids_is_the_set_difference():
    assert _orphan_ids({"1", "2", "3"}, {"2", "3", "4"}) == ["4"]
    assert _orphan_ids({"1"}, {"1"}) == []


def test_prune_orphans_removes_only_pages_that_vanished(monkeypatch):
    """A page deleted in Confluence must lose its kb_meta row AND its vectors."""
    session, vectors = _wire(monkeypatch, ["1736705", "1966081", "2785282"])

    removed = _prune_orphans({"1966081", "2785282"})

    assert removed == 1
    assert session.deleted == ["1736705"]
    assert vectors == ["1736705"]
    assert session.committed is True


def test_prune_orphans_never_empties_the_kb(monkeypatch):
    """An unconfigured connector loads nothing — that must not delete the knowledge base."""
    session, vectors = _wire(monkeypatch, ["1", "2", "3"])

    assert _prune_orphans(set()) == 0
    assert session.deleted == []
    assert vectors == []
    assert session.committed is False
