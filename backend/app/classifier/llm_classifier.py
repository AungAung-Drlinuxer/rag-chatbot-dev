"""LLM-based domain classifier (P3) — the accurate path, with the keyword
classifier kept as the offline fallback.

WHY
---
`engine.classify_domain` is a substring counter: it scores 1 hit as 0.75, which is
exactly STAGE1_CONFIDENCE, so a single coincidental word match is treated as
trustworthy. Live evidence: "What is the SDLC engineering process and what are the
key stages?" -> ("server", 0.75), which filtered retrieval to `server` while the
answer sat under `general`, and the user was told "I couldn't find information".
It is also blind to Burmese, while the KB contains Burmese (Notion) articles.

HOW
---
The domain catalogue already carries what an LLM needs: `display_name` and
`description` (admin-editable in the Knowledge page). Those become the prompt, so
adding a domain is a data change, not a code change. `keywords` stay as the
fallback path.

SAFETY
------
Every failure returns None and the caller falls back to the keyword classifier, so
an LLM outage (or air-gapped deployment with no model) degrades instead of
breaking. Results are cached with a bounded LRU because chat repeats questions.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time

logger = logging.getLogger("classifier.llm")

_CACHE: dict[str, tuple[float, tuple[str, float, str] | None]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_MAX = 512
_CACHE_TTL = 3600.0

_PROMPT = """You are a routing classifier for an IT knowledge base. Choose the single
best domain for the user's question.

Domains (key — what belongs here):
{catalogue}

Rules:
- Answer with JSON only, no prose.
- "domain" MUST be one of the keys above.
- If nothing fits well, use "general".
- "confidence" is 0..1 and must reflect genuine certainty: use a low value
  (<0.6) when the question is ambiguous or spans several domains.
- "reason" is one short sentence naming the words that drove the choice.

Question: {question}

JSON:"""


def _catalogue() -> tuple[str, list[str]]:
    """Render the admin-managed domain catalogue into prompt lines + valid keys."""
    from sqlalchemy import text

    from app.persistence.database import SessionLocal

    with SessionLocal() as s:
        rows = s.execute(text(
            "SELECT domain_key, display_name, description FROM classifier_domains "
            "WHERE is_active = true ORDER BY id"
        )).fetchall()
    keys: list[str] = []
    lines: list[str] = []
    for key, name, desc in rows:
        keys.append(key)
        lines.append(f"- {key} — {name or key}: {(desc or '').strip()[:220]}")
    return "\n".join(lines), keys


def _cache_get(key: str):
    with _CACHE_LOCK:
        hit = _CACHE.get(key)
        if hit and (time.time() - hit[0]) < _CACHE_TTL:
            return hit[1]
        if hit:
            _CACHE.pop(key, None)
    return "__miss__"


def _cache_put(key: str, value) -> None:
    with _CACHE_LOCK:
        if len(_CACHE) >= _CACHE_MAX:
            oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][0])[: _CACHE_MAX // 4]
            for k, _ in oldest:
                _CACHE.pop(k, None)
        _CACHE[key] = (time.time(), value)


def _extract_json(raw: str) -> dict | None:
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def classify_domain_llm(question: str):
    """Return (domain, confidence, reason) or None when the LLM cannot be used.

    None means "fall back to the keyword classifier" — never an error.
    """
    q = (question or "").strip()
    if len(q) < 3:
        return None

    cache_key = q.lower()[:400]
    cached = _cache_get(cache_key)
    if cached != "__miss__":
        return cached

    try:
        from app.llm.client import make_llm

        llm = make_llm()
        if llm is None:
            return None

        catalogue, keys = _catalogue()
        if not keys:
            return None

        prompt = _PROMPT.format(catalogue=catalogue, question=q[:1200])
        resp = llm.invoke(prompt)
        raw = getattr(resp, "content", None) or str(resp)
        data = _extract_json(str(raw))
        if not data:
            logger.info("llm classifier: unparseable reply — falling back")
            _cache_put(cache_key, None)
            return None

        domain = str(data.get("domain") or "").strip().lower()
        if domain not in keys:
            logger.info("llm classifier: %r not in the catalogue — falling back", domain)
            _cache_put(cache_key, None)
            return None

        try:
            conf = float(data.get("confidence"))
        except (TypeError, ValueError):
            conf = 0.6
        conf = max(0.0, min(1.0, conf))
        reason = str(data.get("reason") or "")[:200]

        out = (domain, round(conf, 3), reason)
        _cache_put(cache_key, out)
        logger.info("llm classifier: %r -> %s (%.2f) %s", q[:50], domain, conf, reason)
        return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm classifier unavailable (%s: %s) — keyword fallback",
                       type(exc).__name__, exc)
        return None


def classify_domain_smart(question: str) -> tuple[str, float, str]:
    """LLM first, keyword classifier as the guaranteed fallback.

    Always returns a usable (domain, confidence, reason).
    """
    got = classify_domain_llm(question)
    if got:
        return got

    from app.classifier.engine import classify_domain

    domain, conf = classify_domain(question)
    return domain, conf, f"keyword fallback ({conf:.2f})"


def cache_stats() -> dict:
    with _CACHE_LOCK:
        return {"entries": len(_CACHE), "max": _CACHE_MAX, "ttl_s": _CACHE_TTL}