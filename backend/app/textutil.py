"""Small deterministic text helpers shared across API modules.

No external deps, no LLM calls — safe to import anywhere.
"""
from __future__ import annotations

import re

# Leading filler phrases stripped from a first user question when deriving a
# conversation title. Order matters: longer forms first so "how do i please"
# reduces cleanly in successive passes.
_FILLER_PREFIX = re.compile(
    r"^(?:please\s+|pls\s+|kindly\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|"
    r"i\s+need\s+(?:to\s+)?|i\s+want\s+(?:to\s+)?|i\s+wanna\s+|help\s+me\s+|"
    r"tell\s+me\s+(?:about\s+)?|explain\s+(?:to\s+me\s+)?|show\s+me\s+|"
    r"how\s+do\s+i\s+|how\s+can\s+i\s+|how\s+to\s+|"
    r"what\s+is\s+(?:the\s+)?|what\s+are\s+(?:the\s+)?|"
    r"what'?s\s+(?:the\s+)?|where\s+is\s+(?:the\s+)?|"
    r"is\s+there\s+(?:a\s+|any\s+)?|do\s+you\s+know\s+)\s*",
    re.IGNORECASE,
)

_MAX_TITLE = 60


def collapse_ws(text: str) -> str:
    """Collapse all whitespace runs (incl. newlines) to single spaces."""
    return " ".join((text or "").split())


def auto_title(question: str, max_len: int = _MAX_TITLE) -> str:
    """Derive a short, human-readable conversation title from a user question.

    Deterministic (no LLM call) so repeated derivations — listing the sidebar,
    a re-sync, or a backfill job — always produce the identical title.

    Steps:
      1. collapse whitespace / strip newlines (chat input is multi-line)
      2. repeatedly strip leading filler ("how do I", "please", "can you", ...)
      3. cap on a word boundary and add an ellipsis when truncated
      4. uppercase the first character only
    """
    q = collapse_ws(question)
    prev = None
    # Loop: stacked fillers like "please can you how do i ..." need several passes.
    while prev != q:
        prev = q
        q = _FILLER_PREFIX.sub("", q).strip()

    if not q:
        return "New conversation"

    if len(q) > max_len:
        cut = q[:max_len].rsplit(" ", 1)[0] or q[:max_len]
        q = cut.rstrip(" ,.;:-") + "…"

    return q[:1].upper() + q[1:]
