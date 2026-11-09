"""LLM-assisted domain profiles: description + keyword fallback.

The chat router classifies with an LLM using each domain's name and description; the keyword
list is the offline/fast fallback. A new domain therefore starts blind — no description, no
keywords — and the board says so. Rather than make an admin invent 20 words, ask the model that
already classifies questions to propose both, grounded in the domain name and the titles of the
articles that already sit in that domain.

Every failure returns None: a suggestion is a convenience, never a dependency.
"""
from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger("classifier.profile")

_PROMPT = """You maintain the routing rules of an IT help-desk knowledge base.

Domain key: {key}
Display name: {name}
Current description: {description}
Current keywords: {keywords}
Titles of articles already classified into this domain:
{titles}

Write a profile that lets a router recognise this domain.

Rules:
- "description": ONE sentence, max 220 characters, saying what belongs here and what does not.
- "keywords": 10-18 short lowercase terms or phrases a user would actually type (include
  product names, error strings and Burmese terms only if they appear in the titles).
- No duplicates, no generic words like "help" or "issue".
- Answer with JSON only, exactly: {{"description": "...", "keywords": ["...", "..."]}}
"""


def _extract_json(raw: str) -> dict | None:
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def suggest_profile(*, key: str, name: str, description: str = "",
                    keywords: list[str] | None = None,
                    titles: list[str] | None = None) -> dict | None:
    """Return {"description": str, "keywords": [...]} or None when the LLM is unavailable."""
    try:
        from app.llm.client import make_llm

        llm = make_llm()
        if llm is None:
            return None

        prompt = _PROMPT.format(
            key=key,
            name=name or key,
            description=(description or "").strip()[:400] or "(none yet)",
            keywords=", ".join((keywords or [])[:40]) or "(none yet)",
            titles="\n".join(f"- {t}" for t in (titles or [])[:25]) or "(no articles yet)",
        )
        resp = llm.invoke(prompt)
        raw = getattr(resp, "content", None) or str(resp)
        data = _extract_json(str(raw))
        if not data:
            return None

        desc = str(data.get("description") or "").strip()
        kws = data.get("keywords") or []
        if not isinstance(kws, list):
            return None
        cleaned: list[str] = []
        seen: set[str] = set()
        for k in kws:
            term = str(k).strip().lower()
            if not term or len(term) > 48 or term in seen:
                continue
            seen.add(term)
            cleaned.append(term)
        if not desc and not cleaned:
            return None
        return {"description": desc[:280], "keywords": cleaned[:40]}
    except Exception as exc:
        logger.info("profile suggestion failed: %s", exc)
        return None
