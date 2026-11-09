"""Turn a chat conversation into a Jira ticket draft — without inventing anything.

Three rules shape this module:

1. **The model only reformats what is in the transcript.** Every field the prompt asks for
   is either quoted from the conversation or left empty; `missing_info` is where the gaps
   go. A ticket that claims "business impact: 500 users blocked" because a model felt
   helpful is worse than a ticket with an empty field.
2. **Secrets leave before the prompt does.** The same patterns that guard the chat input
   are applied to every message, so an API key pasted last week cannot end up in a Jira
   ticket or a third-party LLM request.
3. **The description the user edits is the description that is sent.** `compose_description`
   is deterministic, and the API stores a hash of the approved body; submission recomputes
   the hash from what arrives. Nothing is regenerated between review and submit.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re

logger = logging.getLogger("escalation")

MAX_TRANSCRIPT_CHARS = 7_000
MAX_MESSAGES = 12

# Words too common to prove two messages are about the same issue.
_STOP = {
    "the", "and", "for", "with", "that", "this", "from", "have", "has", "had", "was",
    "were", "are", "is", "not", "but", "you", "your", "our", "can", "could", "would",
    "should", "please", "help", "how", "what", "why", "when", "where", "which", "there",
    "here", "then", "than", "them", "they", "its", "it's", "im", "i'm", "get", "got",
    "still", "just", "like", "want", "need", "does", "did", "doing", "about", "into",
    "over", "under", "after", "before", "again", "also", "very", "more", "most", "some",
}

_SECTION_TITLES = [
    ("problem", "Problem"),
    ("environment", "Environment"),
    ("symptoms", "Symptoms"),
    ("error_messages", "Error messages"),
    ("troubleshooting_done", "Troubleshooting already performed"),
    ("suggested_unverified", "Suggested but not yet confirmed"),
    ("current_status", "Current status"),
    ("escalation_reason", "Reason for escalation"),
    ("business_impact", "Business impact"),
]


# --------------------------------------------------------------------------- redaction
def _redaction_patterns() -> list[tuple[re.Pattern[str], str]]:
    """Reuse the chat guardrail patterns so the two cannot drift apart."""
    from app.security.guardrails import _PII_PATTERNS  # noqa: PLC0415 — avoids a cycle

    extra = [
        (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "email"),
        (r"(?i)\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}", "password"),
    ]
    out = [(re.compile(p, re.IGNORECASE) if isinstance(p, str) else p, label)
           for p, label in _PII_PATTERNS]
    out += [(re.compile(p), label) for p, label in extra]
    return out


_PATTERNS = None


def redact(text: str) -> str:
    """Replace credential/PII shapes with a labelled placeholder and nothing else."""
    global _PATTERNS
    if _PATTERNS is None:
        _PATTERNS = _redaction_patterns()
    out = text or ""
    for pattern, label in _PATTERNS:
        out = pattern.sub(f"[REDACTED: {label}]", out)
    return out


# --------------------------------------------------------------------------- relevance
def _keywords(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9_.-]{3,}", (text or "").lower())
    return {w.strip("._-") for w in words if w.strip("._-") not in _STOP}


def select_relevant(messages: list[dict], max_messages: int = MAX_MESSAGES) -> list[dict]:
    """Messages that belong to the issue the user is escalating.

    The anchor is the last user question — that is the issue being escalated. From there
    we take the answer that followed it, then walk backwards accepting a message when it
    shares a keyword with the anchor, stopping after four consecutive misses (a topic
    change). The message immediately before the anchor is always kept: conversations
    routinely open with the problem and continue with "what error do you see?", so the
    turn above the anchor is usually where the symptom is written.
    """
    if not messages:
        return []

    anchor = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=len(messages) - 1)
    anchor_words = _keywords(messages[anchor].get("content", ""))

    picked = {anchor}
    # The answer to the anchor belongs to the issue even though it is the assistant's.
    if anchor + 1 < len(messages):
        picked.add(anchor + 1)

    misses = 0
    for i in range(anchor - 1, -1, -1):
        if len(picked) >= max_messages or misses >= 4:
            break
        text = messages[i].get("content", "")
        if i == anchor - 1 or (_keywords(text) & anchor_words):
            picked.add(i)
            misses = 0
        else:
            misses += 1

    ordered = [messages[i] for i in sorted(picked)][-max_messages:]

    # Character budget, dropping the oldest first: the tail carries the issue.
    total, keep = 0, []
    for m in reversed(ordered):
        total += len(m.get("content", ""))
        if total > MAX_TRANSCRIPT_CHARS and keep:
            break
        keep.append(m)
    return list(reversed(keep))


def transcript_block(messages: list[dict]) -> str:
    """Redacted, role-labelled transcript for the prompt."""
    lines = []
    for m in messages:
        role = "User" if m.get("role") == "user" else "Assistant"
        lines.append(f"{role}: {redact(m.get('content', '')).strip()}")
    return "\n\n".join(lines)


# --------------------------------------------------------------------------- drafting
_PROMPT = """You are drafting a Jira ticket from an IT support chat transcript.

STRICT RULES
- Use ONLY facts present in the transcript. Never guess a root cause, a priority, an
  impact figure, an environment detail or a step the user did not describe.
- If a field has no support in the transcript, return an empty string (or empty list).
- "troubleshooting_done" = steps the USER says they performed, with the result.
- "suggested_unverified" = steps the ASSISTANT recommended that the user has not said
  they performed. Do not mix the two.
- "business_impact" only when the user stated one (people blocked, deadline, money).
- Keep "summary" under 110 characters, imperative or noun phrase, no ticket key.
- "missing_info" lists what an engineer would still need to know, phrased as questions.

TRANSCRIPT
{transcript}

Return JSON only, exactly this shape:
{{
  "summary": "",
  "problem": "",
  "environment": "",
  "symptoms": [],
  "error_messages": [],
  "troubleshooting_done": [],
  "suggested_unverified": [],
  "current_status": "",
  "escalation_reason": "",
  "business_impact": "",
  "missing_info": []
}}"""


def _extract_json(raw: str) -> dict | None:
    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _as_list(value) -> list[str]:
    if isinstance(value, str):
        value = [value] if value.strip() else []
    if not isinstance(value, list):
        return []
    out, seen = [], set()
    for item in value:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _as_text(value) -> str:
    return str(value).strip() if value is not None else ""


def normalise(raw: dict | None) -> dict:
    """Keep only the known keys, coerce types, drop anything the model invented."""
    raw = raw or {}
    out = {
        "summary": _as_text(raw.get("summary"))[:120],
        "problem": _as_text(raw.get("problem")),
        "environment": _as_text(raw.get("environment")),
        "symptoms": _as_list(raw.get("symptoms")),
        "error_messages": _as_list(raw.get("error_messages")),
        "troubleshooting_done": _as_list(raw.get("troubleshooting_done")),
        "suggested_unverified": _as_list(raw.get("suggested_unverified")),
        "current_status": _as_text(raw.get("current_status")),
        "escalation_reason": _as_text(raw.get("escalation_reason")),
        "business_impact": _as_text(raw.get("business_impact")),
        "missing_info": _as_list(raw.get("missing_info")),
    }
    return out


def fallback_draft(messages: list[dict]) -> dict:
    """No LLM available: quote the conversation instead of summarising it.

    A draft made of the user's own words is honest and still saves typing; a fabricated
    summary is not. Missing sections stay empty and are surfaced in `missing_info`.
    """
    asks = [redact(m.get("content", "")) for m in messages if m.get("role") == "user"]
    answers = [redact(m.get("content", "")) for m in messages if m.get("role") == "assistant"]
    first = (asks[0] if asks else "").strip()
    last = (asks[-1] if asks else "").strip()
    summary = (last or first).split("\n")[0][:110] or "IT support request"
    return normalise({
        "summary": summary,
        "problem": "\n\n".join(a.strip() for a in asks if a.strip())[:2000],
        "symptoms": [],
        "error_messages": [],
        "troubleshooting_done": [],
        "suggested_unverified": [],
        "current_status": (answers[-1].strip()[:600] if answers else ""),
        "escalation_reason": "The assistant could not resolve the issue from the knowledge base.",
        "business_impact": "",
        "missing_info": [
            "Which system or service is affected?",
            "What error message or code do you see?",
            "When did it start, and is it constant or intermittent?",
            "Which troubleshooting steps have you already tried?",
        ],
    })


def generate_draft(messages: list[dict]) -> tuple[dict, str]:
    """Return (draft fields, source) where source is 'llm' or 'fallback'."""
    relevant = select_relevant(messages)
    # Redact before anything else looks at the text: the fallback quotes the user, the
    # prompt quotes the user, and the compose step must never see a live credential.
    relevant = [{**m, "content": redact(m.get("content", ""))} for m in relevant]
    block = transcript_block(relevant)
    if not block.strip():
        return fallback_draft([]), "fallback"

    try:
        from app.llm.client import make_llm

        llm = make_llm()
        if llm is not None:
            resp = llm.invoke(_PROMPT.format(transcript=block))
            raw = getattr(resp, "content", None) or str(resp)
            data = _extract_json(str(raw))
            if data:
                fields = normalise(data)
                if fields["summary"]:
                    return fields, "llm"
            logger.info("draft: model returned no usable JSON, using the fallback")
    except Exception as exc:  # noqa: BLE001 — a draft must exist even when the LLM is down
        logger.warning("draft generation failed (%s): %s", type(exc).__name__, exc)

    return fallback_draft(relevant), "fallback"


# --------------------------------------------------------------------------- compose
def compose_description(fields: dict) -> str:
    """Markdown body — only the sections that have content, in a fixed order."""
    parts: list[str] = []
    for key, title in _SECTION_TITLES:
        value = fields.get(key)
        if isinstance(value, list):
            items = [v for v in value if str(v).strip()]
            if not items:
                continue
            parts.append(f"*{title}*\n" + "\n".join(f"- {v}" for v in items))
        else:
            value = str(value or "").strip()
            if value:
                parts.append(f"*{title}*\n{value}")

    links = [l for l in (fields.get("kb_links") or []) if l.get("url")]
    if links:
        parts.append("*Related knowledge base*\n" + "\n".join(
            f"- {l.get('title') or l['url']} — {l['url']}" for l in links))

    missing = [m for m in (fields.get("missing_info") or []) if str(m).strip()]
    if missing:
        parts.append("*Still needed*\n" + "\n".join(f"- {m}" for m in missing))

    return "\n\n".join(parts)


def content_hash(fields: dict) -> str:
    """Hash of exactly what the user reviewed: summary + description + routing fields."""
    payload = {
        "summary": fields.get("summary", ""),
        "description": fields.get("description", ""),
        "project": fields.get("project", ""),
        "issue_type": fields.get("issue_type", ""),
        "priority": fields.get("priority", ""),
        "custom_fields": fields.get("custom_fields") or {},
    }
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
