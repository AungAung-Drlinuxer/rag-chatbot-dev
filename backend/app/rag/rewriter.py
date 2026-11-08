"""Query rewriter — convert a raw user turn into a clean semantic search query.

Phase 1 MVP: heuristic rewrite. Folds the previous turns into a standalone query so
follow-ups ("what about that error?") still retrieve well. LLM-driven rewrite is a
Phase 2 enhancement (noted in the design doc §3 ②).
"""
from __future__ import annotations

import re


def rewrite_query(query: str, history: list[dict] | None = None) -> str:
    """Return a self-contained search query.

    - Strip filler words / trailing punctuation.
    - If the query looks like a follow-up (short + pronoun-ish), append the last
      user turn's subject terms for context.
    """
    text = (query or "").strip()
    if not text:
        return ""

    # Normalise whitespace + drop trailing punctuation
    text = re.sub(r"\s+", " ", text).strip()

    # Follow-up heuristic: short query or starts with a pronoun → borrow last turn
    follow_up = len(text.split()) <= 4 or text.lower().startswith(
        ("what about", "how about", "why", "what's", "it", "that")
    )
    if follow_up and history:
        last_user = next((m.get("content") for m in reversed(history) if m.get("role") == "user"), "")
        if last_user and last_user != query:
            # Combine prior subject terms with the current question stem
            prior_terms = " ".join(last_user.split()[:8])
            return f"{text} {prior_terms}".strip()
    return text
