"""Deterministic small-talk handling for the chat entry point.

WHY THIS EXISTS
---------------
Before this module, "Hi" went through the full RAG pipeline: retrieval found nothing
relevant, the answer was generated from whatever weak context survived, and the UI
displayed three KB articles under a greeting. A support assistant that answers "hello"
with an AWS security document is worse than one that answers it with hello — and the
retrieval cost is paid for every opening message of every conversation.

RULES
-----
1. Only *whole-message* matches count. "hi how do I reset my VPN password" is a real
   question and must reach retrieval, so matching requires the entire normalised message
   to be a greeting/thanks/ack, not a prefix.
2. The message must be short (<= 60 chars). Long messages are questions.
3. Replies are fixed strings: no model call, no retrieval, no confidence score. They are
   the same strings every time, so an auditor can predict them.

Anything not matched here falls through to the normal pipeline untouched.
"""
from __future__ import annotations

import re
import unicodedata

# Normalised (lowercase, punctuation stripped) whole messages.
_GREETINGS = {
    "hi", "hii", "hiii", "hello", "helo", "hey", "heya", "hiya", "yo", "howdy",
    "hi there", "hello there", "hey there", "hi bot", "hello bot", "hey bot",
    "good morning", "good afternoon", "good evening", "good day",
    "မင်္ဂလာပါ", "ဟယ်လို", "ဟေး", "နေကောင်းလား", "မင်္ဂလာပါရှင့်",
    "chào", "xin chào", "สวัสดี", "नमस्ते",
}
_HOW_ARE_YOU = {
    "how are you", "how are you doing", "hows it going", "how is it going",
    "how do you do", "whats up", "sup", "how have you been", "နေကောင်းလား",
}
_THANKS = {
    "thanks", "thank you", "thankyou", "thx", "many thanks", "thanks a lot",
    "thanks so much", "cheers", "got it thanks", "great thanks", "perfect thanks",
    "okay thanks", "that helps", "that helps thanks", "thank you that helps", "ကျေးဇူးတင်ပါတယ်", "ကျေဇူးတင်ပါတယ်",
    "cảm ơn", "ขอบคุณ",
}
_BYE = {
    "bye", "goodbye", "good bye", "see you", "see ya", "later", "good night",
    "goodnight", "သွားတော့မယ်", "တာ့တာ",
}
_IDENTITY = {
    "who are you", "what are you", "what can you do", "what do you do",
    "help", "what is this", "နင် ဘယ်သူလဲ", "မင်း ဘယ်သူလဲ", "ဘာလုပ်ပေးနိုင်လဲ",
    "what can i ask", "how does this work",
}
_ACK = {
    "ok", "okay", "k", "sure", "yes", "yeah", "yep", "no", "nope", "got it",
    "alright", "cool", "nice", "great", "perfect", "fine", "understood",
    "ok thanks", "okay thanks", "ok thank you", "okay thank you",
    "ရပါပြီ", "အိုကေ", "ဟုတ်ကဲ့", "ကောင်းပါပြီ",
}

_REPLIES = {
    "greeting": "Hello! I'm your internal IT support assistant. How can I help you today?",
    "how_are_you": (
        "I'm running well, thanks for asking. What can I help you with today — access, "
        "hardware, or a system issue?"
    ),
    "thanks": "You're welcome. Anything else I can help with?",
    "bye": "Goodbye — I'm here whenever you need IT support.",
    "identity": (
        "I'm the IT support assistant for your organization. I answer from your internal "
        "knowledge base and cite the pages I used. Ask me about access, hardware, "
        "networking, or an incident."
    ),
    "ack": "Got it. Ask me anything about your IT environment and I'll look it up.",
}

MAX_CHARS = 60


def normalise(text: str) -> str:
    """Lowercase, strip punctuation/emoji, collapse whitespace.

    Unicode-aware: Burmese and CJK have no ASCII word boundaries, so this must not try
    to tokenise — it only removes characters that are neither letters nor spaces.
    """
    text = (text or "").strip().lower()
    # Apostrophes vanish rather than become spaces: "how's" must normalise to "hows",
    # not "how s", or it misses the phrase it obviously is.
    text = text.replace("'", "").replace("\u2019", "")
    # Drop emoji/symbols, keep letters (incl. Burmese), digits, combining marks and
    # whitespace. Burmese vowels/tone marks are category Mn, which `isalnum()` rejects —
    # without them "မင်္ဂလာပါ" degrades to "မင ဂလ ပ" and never matches.
    cleaned = "".join(
        ch if (ch.isalnum() or ch.isspace() or unicodedata.category(ch).startswith("M")) else " "
        for ch in text
        if unicodedata.category(ch)[0] not in {"S"}
    )
    cleaned = re.sub(r"[\u200b-\u200f\ufeff]", "", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def classify(message: str) -> str | None:
    """Return the small-talk kind for a whole-message match, else None."""
    raw = (message or "").strip()
    if not raw or len(raw) > MAX_CHARS:
        return None
    n = normalise(raw)
    if not n:
        return None
    if n in _GREETINGS:
        return "greeting"
    if n in _HOW_ARE_YOU:
        return "how_are_you"
    if n in _THANKS:
        return "thanks"
    if n in _BYE:
        return "bye"
    if n in _IDENTITY:
        return "identity"
    if n in _ACK:
        return "ack"
    return None


def reply(kind: str) -> str:
    return _REPLIES.get(kind, _REPLIES["greeting"])
