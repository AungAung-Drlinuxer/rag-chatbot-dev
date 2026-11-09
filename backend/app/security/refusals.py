"""What the assistant says when a guardrail fires.

Two rules for every message here:

1. **It is an answer, not an error banner.** A blocked request still gets a complete,
   polite reply in the chat — otherwise the user sees a warning with nothing under it and
   the conversation looks broken (that was the old behaviour for `blocked`).
2. **It never repeats the offending text.** Echoing a prompt-injection payload or a card
   number back to the user is how a filter turns into a leak.

The wording is per rule on purpose: "your message contains personal data" tells the user
what to change; "security policy" alone does not.
"""
from __future__ import annotations

_COMMON_TAIL = ("If you're trying to reach IT support, rephrase the question and I'll help "
                "with passwords, VPN access, hardware, accounts or anything in the knowledge base.")

# Keyed by GuardrailResult.type. `pass` never reaches here.
REFUSALS: dict[str, str] = {
    "injection": (
        "I can't act on that message. It contains instructions that try to change how I "
        "operate — overriding my rules, revealing my configuration, or making me act as a "
        "different system. I only answer IT support questions, and I follow the same policy "
        "for every request. " + _COMMON_TAIL
    ),
    "pii": (
        "I can't accept that message because it appears to contain personal or secret data — "
        "a national ID number, a payment card number, or an API key. Please remove it and ask "
        "again; never send credentials in chat. If a credential was exposed, report it to IT "
        "security so it can be rotated. " + _COMMON_TAIL
    ),
    "overflow": (
        "That message is too long for me to process safely. Please shorten it to the actual "
        "question — attach a file from the ticket instead of pasting its contents. " + _COMMON_TAIL
    ),
    "profanity": (
        "I want to help with this, but I can't continue while the message is abusive. Tell me "
        "what you need — the error, the system, and what you already tried — and I'll take it "
        "from there. " + _COMMON_TAIL
    ),
    "toxic": (
        "I want to make sure you get the support you need, but I can't respond to messages with "
        "that tone. I'm here to help with passwords, VPN access, hardware issues, and any other "
        "IT requests — just let me know what you need and I'll get right on it."
    ),
}

_FALLBACK = (
    "I can't process that request — it doesn't pass our content policy. " + _COMMON_TAIL
)


def refusal_for(guardrail_type: str) -> str:
    """The policy-aligned answer for a guardrail verdict."""
    return REFUSALS.get((guardrail_type or "").strip().lower(), _FALLBACK)


def is_blocked(guardrail_type: str) -> bool:
    """Blocked requests are never answered by the model; flagged ones are de-escalated."""
    return (guardrail_type or "").strip().lower() not in {"profanity", "toxic"}
