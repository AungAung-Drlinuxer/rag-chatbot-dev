"""Every `req.<x>` in the chat router must be a field of ChatRequest.

A missing attribute here is uniquely painful: it raises *inside* the SSE generator, after the
response headers are sent, so the browser never receives an error object — the proxy reports an
empty upstream stream (Cloudflare shows this as 520) and the user sees "The answer could not be
generated". A static check is the only cheap way to catch it, because the failure needs a live
model call to reproduce.
"""
from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.api import chat
from app.schemas import ChatRequest

SOURCE = Path(inspect.getfile(chat)).read_text()


def _fields(cls) -> set[str]:
    return set(getattr(cls, "model_fields", {}))


def test_chat_request_has_no_mode_field():
    # The schema exposes llm_provider ("auto" | "cloud" | "local"); "mode" was never a field.
    assert "llm_provider" in _fields(ChatRequest)
    assert "mode" not in _fields(ChatRequest)


def test_chat_router_does_not_read_req_mode():
    assert "req.mode" not in SOURCE


def _req_attributes(func_name: str) -> set[str]:
    """`req.<x>` accesses made inside one handler (each handler has its own schema)."""
    tree = ast.parse(SOURCE)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            return {
                child.attr
                for child in ast.walk(node)
                if isinstance(child, ast.Attribute)
                and isinstance(child.value, ast.Name)
                and child.value.id == "req"
            }
    raise AssertionError(f"{func_name} not found in chat.py")


def test_every_req_attribute_exists_on_the_schema():
    used = _req_attributes("chat_stream")
    assert used, "the scanner found no req.<attr> accesses — the AST walk is broken"
    missing = sorted(used - _fields(ChatRequest))
    assert not missing, f"chat_stream reads attributes ChatRequest does not define: {missing}"


def test_the_feedback_handler_reads_its_own_schema():
    # Guards the general shape: the same `req` name is reused by other handlers with other
    # schemas, which is why the scan above is per-function rather than per-file.
    from app.schemas import FeedbackRequest

    used = _req_attributes("feedback")
    assert used - _fields(FeedbackRequest) == set()


def test_small_talk_meta_reports_the_provider_not_a_mode():
    # The greeting path is where the crash lived; its meta must carry a real value.
    assert '"mode": (req.llm_provider or "auto").strip().lower(),' in SOURCE
