"""Phase 10 — RECENT CONVERSATIONS: list / load / clear (GET/DELETE /api/conversations)."""
from fastapi.testclient import TestClient

from app.auth.jwt import create_access_token
from app.main import app

client = TestClient(app)


def _token() -> str:
    """A signed token, not a login round trip.

    These suites used to POST /api/auth/login with dev/dev, which only worked while the
    dev password bypass existed. The bypass is gone — a credential row is required — and
    these endpoints only need an authenticated principal, so mint one directly.
    """
    return create_access_token("dev")


def _auth() -> dict:
    return {"Authorization": f"Bearer {_token()}"}


def test_list_conversations_shape():
    r = client.get("/api/conversations", headers=_auth())
    assert r.status_code == 200, r.text
    data = r.json()
    assert "conversations" in data
    assert isinstance(data["conversations"], list)
    for c in data["conversations"]:
        assert "session_id" in c and "title" in c and "last_at" in c and "messages" in c


def test_conversation_messages_shape():
    r = client.get("/api/conversations", headers=_auth())
    convs = r.json()["conversations"]
    if convs:
        sid = convs[0]["session_id"]
        m = client.get(f"/api/conversations/{sid}/messages", headers=_auth())
        assert m.status_code == 200, m.text
        for msg in m.json()["messages"]:
            assert msg["role"] in ("user", "assistant")
            assert "content" in msg and "meta" in msg and "caution" in msg


def test_invalid_session_400():
    r = client.get("/api/conversations/not-a-uuid/messages", headers=_auth())
    assert r.status_code == 400


def test_clear_requires_auth():
    r = client.delete("/api/conversations")
    assert r.status_code in (401, 403)
