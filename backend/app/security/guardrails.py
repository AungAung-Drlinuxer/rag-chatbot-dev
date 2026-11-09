"""Input guardrails — prompt-injection / overflow / PII / profanity / toxicity.

Deterministic regex screening on every chat request, before any LLM cost or DB write.
No LLM in the loop, so it cannot be argued past by prompt-tuning the model itself;
adds well under a millisecond.

- PROMPT OVERFLOW  message length cap (LLM cost + context stuffing)  → blocked
- INJECTION        instruction-override / role-escape / exfiltration  → blocked
- PII              SSN / card / API-key shapes                        → blocked
- PROFANITY        English roots (repeats, separators, suffixes) + Burmese → flagged
- TOXICITY         abuse aimed at the assistant                       → flagged

Profanity matching is deliberately loose, because the ways to write one word are not:

    fuck  FUCK  fuuuck  fucking  f u c k  f.u.c.k  f*u*c*k  f-u-c-k  fu-u-ck

One pattern per root covers all of them: every letter may repeat (`f+`) and
non-alphanumerics may sit between letters (`[\\W_]{0,2}`). The suffix group and the
trailing boundary sit OUTSIDE that, so "fucking" is caught whole while "damnation"
and "Scunthorpe" still pass.

Burmese (and any other non-Latin script) is matched as a literal, because `\\b` needs
`\\w` neighbours that those scripts do not provide.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger("guardrails")

MAX_MESSAGE_CHARS = 4_000          # generous for real questions; kills cost-stuffing
MAX_MESSAGE_HARD = 32_000          # absolute reject regardless of config

# --- Prompt-injection heuristics (English; deterministic regex) ---------------
_INJECTION_PATTERNS: list[tuple[str, str]] = [
    (r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)", "instruction_override"),
    (r"disregard\s+(all\s+)?(?:previous\s+|your\s+|the\s+)+(instructions|rules|training|guidelines|policies)", "instruction_override"),
    (r"you\s+are\s+now\s+(dan|developer\s+mode|unfiltered|jailbreak)", "role_hijack"),
    (r"system\s+p(rompt|essage)\s*[:=]", "system_prompt_probe"),
    (r"(print|show|reveal|repeat|output|display)\s+(me\s+)?(your\s+|the\s+|this\s+)?(full\s+|entire\s+|complete\s+|original\s+)?system\s+prompt", "system_prompt_probe"),
    (r"(your\s+)?(initial|original|secret)\s+(instructions|prompt)", "system_prompt_probe"),
    (r"act\s+as\s+an?\s+(unrestricted|uncensored|amoral|evil)", "role_hijack"),
    (r"developer\s+mode\s+enabled", "role_hijack"),
    (r"you\s+(have\s+|are\s+in\s+)?(admin|root|sudo|god)\s+(mode|access|tools)", "privilege_escalation"),
    (r"(execute|run)\s+(this\s+)?(sql|shell|command)\s*[:：]", "tool_abuse"),
    (r"select\s+\*\s+from\s+(users|pg_|sys\.)", "tool_abuse"),
    (r"document\.location|exfil|steal\s+.*cookie|fetch\(['\"]http", "data_exfiltration"),
    (r"pretend\s+(you\s+are|to\s+be)\s+.{0,40}((with\s+|having\s+)?no\s+(restrictions|limits|rules|filters)|without\s+(any\s+)?(rules|limits|restrictions|filters)|unrestricted|uncensored|amoral|evil)", "role_hijack"),
    (r"from\s+now\s+on\s+(you\s+will|you\s+are)", "instruction_override"),
]

# --- PII heuristics (SSN, credit card, API keys) -----------------------------
_PII_PATTERNS: list[tuple[str, str]] = [
    (r"\b\d{3}-\d{2}-\d{4}\b", "SSN pattern (###-##-####)"),
    (r"\b(?:\d{4}[-\s]?){3}\d{4}\b", "credit-card pattern (####-####-####-####)"),
    (r"\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})\b", "API-key pattern (sk-/ghp_)"),
]

# --- Toxicity / abuse heuristics (conservative — refuse + offer help) --------
_TOXIC_PATTERNS: list[str] = [
    r"\b(you\s+(are|re)\s+(a\s+)?(useless|stupid|idiot|trash|garbage))",
    r"\b(useless|garbage|trash)\s+(chatbot|bot|assistant|service|system)",
    r"\b(chatbot|bot|assistant|service)\s+is\s+(useless|garbage|trash|stupid)",
    r"\bhack(ing)?\s+(the\s+)?(ceo|president|someone)['\"s ]*",
]

# --- Profanity: English roots -------------------------------------------------
# Spelled letter by letter so the pattern absorbs repeats ("fuuuck") and separators
# ("f u c k") without needing a second, normalising pass over the message.
_PROFANITY_ROOTS: list[str] = ["fuck", "shit", "bitch", "asshole", "damn", "bastard"]

# --- Profanity: Burmese -------------------------------------------------------
# A starter list — the shop's own vocabulary belongs here too. Longest first so the
# audit reason quotes the most specific match.
_BURMESE_PROFANITY: list[str] = ["မင်းမ", "အကောင်မ", "ဖင်"]

_SUFFIX = r"(?:s|es|ed|ing|er|ers|y|ty)?"


def _root_pattern(root: str) -> str:
    """`fuck` -> `f+(?:[\\W_]{1,2}f+)*[\\W_]{0,2}u+(?:[\\W_]{1,2}u+)*…`.

    Each letter may repeat, and a repeat may itself be split ("u-u", "uu-u"), which is
    what makes `fu-u-ck` and `f u u c k` land on the same pattern as `fuck`.
    """
    letters = [rf"{re.escape(ch)}+(?:[\W_]{{1,2}}{re.escape(ch)}+)*" for ch in root]
    return r"[\W_]{0,2}".join(letters)


_PROFANITY_PATTERNS: list[str] = [
    # Boundaries and suffix sit outside the separator class: "fucking" matches whole,
    # "damnation" does not (the "a" after "damn" is not a listed suffix).
    rf"(?<![A-Za-z0-9]){_root_pattern(root)}{_SUFFIX}(?![A-Za-z0-9])"
    for root in _PROFANITY_ROOTS
]
_BURMESE_PATTERNS: list[str] = [re.escape(w) for w in _BURMESE_PROFANITY]

_INJECTION_RE = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _INJECTION_PATTERNS]
_PII_RE = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _PII_PATTERNS]
_PROFANITY_RE = [(re.compile(pat, re.IGNORECASE), root)
                 for pat, root in zip(_PROFANITY_PATTERNS, _PROFANITY_ROOTS)]
_BURMESE_RE = [(re.compile(pat, re.IGNORECASE), word)
               for pat, word in zip(_BURMESE_PATTERNS, _BURMESE_PROFANITY)]


@dataclass
class GuardrailResult:
    action: str        # "pass" | "blocked" | "flagged"
    type: str          # "injection" | "overflow" | "pii" | "profanity" | "toxic" | "none"
    reason: str


def _profanity_hit(message: str) -> str | None:
    """The first profanity match, quoted for the audit row. English first — it is the
    more common case — then Burmese."""
    for regex, root in _PROFANITY_RE:
        m = regex.search(message)
        if m:
            return f"abusive language: '{m.group(0)[:40]}' (root '{root}')"
    for regex, word in _BURMESE_RE:
        if regex.search(message):
            return f"abusive language: '{word}'"
    return None


def check_input(message: str) -> GuardrailResult:
    """Screen a user chat message. Returns a GuardrailResult verdict.

    Order matters: overflow (cheap) → injection (blocked) → pii (blocked) →
    profanity (flagged) → toxicity (flagged). Detections are logged at WARNING and
    counted by the caller.
    """
    if not message:
        return GuardrailResult("pass", "none", "empty message")

    # 1) Overflow — hard reject
    if len(message) > MAX_MESSAGE_HARD:
        return GuardrailResult("blocked", "overflow",
                               f"message exceeds hard limit of {MAX_MESSAGE_HARD} characters")
    if len(message) > MAX_MESSAGE_CHARS:
        return GuardrailResult("blocked", "overflow",
                               f"message exceeds {MAX_MESSAGE_CHARS} characters")

    # 2) Prompt injection — block outright
    for regex, label in _INJECTION_RE:
        m = regex.search(message)
        if m:
            return GuardrailResult("blocked", "injection",
                                   f"{label}: matched '{m.group(0)[:60]}'")

    # 3) PII leak prevention — block outright
    for regex, label in _PII_RE:
        m = regex.search(message)
        if m:
            return GuardrailResult("blocked", "pii",
                                   f"{label} in user request stream")

    # 4) Profanity — flag
    reason = _profanity_hit(message)
    if reason:
        return GuardrailResult("flagged", "profanity", reason)

    # 5) Toxicity / abuse — flag (refuse at LLM via system prompt; record event)
    for pat in _TOXIC_PATTERNS:
        if re.search(pat, message, re.IGNORECASE):
            return GuardrailResult("flagged", "toxic", f"abusive language: '{pat[:30]}…'")

    return GuardrailResult("pass", "none", "")
