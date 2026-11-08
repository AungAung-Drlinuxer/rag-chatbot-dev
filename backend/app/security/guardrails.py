"""Input guardrails — prompt-injection / overflow / toxicity detection.

v1.1.4 — the GUARDRAIL_EVENTS_TOTAL metric was declared but never incremented;
enforcement did not exist. This module adds real, deterministic input screening
on every chat request:

- PROMPT OVERFLOW: message length cap (LLM cost + context stuffing defense)
- INJECTION: heuristic pattern matching for instruction-override / role-escape /
  data-exfiltration phrasing (blocked outright)
- TOXICITY / abuse: profanity + abuse patterns → refused politely (flagged)

Design: deterministic regex/pattern matching (no LLM dependency) so it can
never be bypassed by prompt-tuning the model itself, and adds <1ms latency.
Detections are counted (GUARDRAIL_EVENTS_TOTAL) and audited.
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

# --- Toxicity / abuse heuristics (conservative list — refuse + offer help) ----
_TOXIC_PATTERNS: list[str] = [
    r"\b(f+u+c+k+|sh+i+t+|b+i+t+c+h+|a+s+s+h+o+l+e+)\b",
    r"\b(you\s+(are|re)\s+(a\s+)?(useless|stupid|idiot|trash|garbage))",
    # v1.6.6 — "useless/garbage/trash" directed AT the chatbot itself
    r"\b(useless|garbage|trash)\s+(chatbot|bot|assistant|service|system)",
    r"\b(chatbot|bot|assistant|service)\s+is\s+(useless|garbage|trash|stupid)",
    r"\bhack(ing)?\s+(the\s+)?(ceo|president|someone)['\"s ]*",
]

_INJECTION_RE = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _INJECTION_PATTERNS]


@dataclass
class GuardrailResult:
    action: str        # "pass" | "blocked" | "flagged"
    type: str          # "injection" | "overflow" | "toxic" | "none"
    reason: str


def check_input(message: str) -> "GuardrailResult":
    """Screen a user chat message. Returns a GuardrailResult verdict.

    Order matters: overflow (cheap) → injection (blocked) → toxicity (flagged).
    Detections are logged at WARNING and counted by the caller.
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

    # 3) Toxicity / abuse — flag (refuse at LLM via system prompt; record event)
    for pat in _TOXIC_PATTERNS:
        if re.search(pat, message, re.IGNORECASE):
            return GuardrailResult("flagged", "toxic", f"abusive language: '{pat[:30]}…'")

    return GuardrailResult("pass", "none", "")
