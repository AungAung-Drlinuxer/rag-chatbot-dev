"""Input and output guardrails — injection / overflow / PII / profanity.

Screening is deterministic (regex, no LLM) so it cannot be argued past by prompt
tuning, and costs well under a millisecond per message.

Behaviour is configurable at runtime from Settings → Guardrails
(`system_settings['guardrails']`, cached for a few seconds so the hot path is not a
database round-trip):

- PROMPT OVERFLOW — length cap (LLM cost + context stuffing defence), always blocked
- PROMPT INJECTION — instruction-override / role-escape / exfiltration phrasing, always blocked
- PII — SSN / card / API-key shapes, always blocked
- PROFANITY — the configured word list, either **masked** (the word is replaced and the
  question is still answered) or **blocked** (the request is refused), per `mode`
- TOXICITY — abuse aimed at the assistant, always flagged and refused

Output filtering masks the same list in the model's answer, on the streamed tokens and in
the text that gets persisted, so a re-opened conversation cannot show a word the live
answer hid.
"""
from __future__ import annotations

import logging
import re
import time
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
    (r"\b\d{3}-\d{2}-\d{4}\b", "masked SSN pattern: XXX-XX-****"),
    (r"\b(?:\d{4}[-\s]?){3}\d{4}\b", "masked Credit Card pattern: ****-****-****-****"),
    (r"\b(sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,})\b", "masked API Key pattern: sk-****"),
]

# --- Toxicity / abuse heuristics (conservative list — refuse + offer help) ----
_TOXIC_PATTERNS: list[str] = [
    r"\b(you\s+(are|re)\s+(a\s+)?(useless|stupid|idiot|trash|garbage))",
    # v1.6.6 — "useless/garbage/trash" directed AT the chatbot itself
    r"\b(useless|garbage|trash)\s+(chatbot|bot|assistant|service|system)",
    r"\b(chatbot|bot|assistant|service)\s+is\s+(useless|garbage|trash|stupid)",
    r"\bhack(ing)?\s+(the\s+)?(ceo|president|someone)['\"s ]*",
]

_INJECTION_RE = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _INJECTION_PATTERNS]
_PII_RE = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _PII_PATTERNS]

# --- Built-in word list (English). Administrators extend it in Settings. -----
# `f+u+c+k+` absorbs "fuuuck"; the list is deliberately small — an organisation
# adds its own language and vocabulary on top instead of trusting a guess.
DEFAULT_PROFANITY = [
    r"f+u+c+k+",
    r"sh+i+t+",
    r"b+i+t+c+h+",
    r"a+s+s+h+o+l+e+",
    r"d+a+m+n",
    r"b+a+s+t+a+r+d+",
]


# ============================================================
# Runtime configuration (system_settings['guardrails'])
# ============================================================

DEFAULT_CONFIG: dict = {
    "enabled": True,
    "mode": "mask",            # "mask"  — replace the word and keep answering
                               # "block" — refuse the whole message
    "output_filter": True,     # mask the same list in the model's answer
    "custom_words": [],        # administrator additions (one word or phrase per entry)
    "use_default_list": True,  # keep the built-in English list alongside custom words
    "mask_char": "*",
}

_CONFIG_TTL = 5.0
_cache: dict = {"at": 0.0, "cfg": None}


def normalise(raw: dict | None) -> dict:
    """Coerce whatever is in the row (or nothing) into a complete, valid config."""
    cfg = dict(DEFAULT_CONFIG)
    if isinstance(raw, dict):
        for key in DEFAULT_CONFIG:
            if key in raw and raw[key] is not None:
                cfg[key] = raw[key]
    if cfg["mode"] not in ("mask", "block"):
        cfg["mode"] = "mask"
    words = cfg.get("custom_words") or []
    if isinstance(words, str):
        words = re.split(r"[\n,]", words)
    cfg["custom_words"] = [str(w).strip() for w in words if str(w).strip()][:500]
    cfg["enabled"] = bool(cfg["enabled"])
    cfg["output_filter"] = bool(cfg["output_filter"])
    cfg["use_default_list"] = bool(cfg.get("use_default_list", True))
    cfg["mask_char"] = (str(cfg.get("mask_char") or "*")[:1]) or "*"
    return cfg


def load_config(force: bool = False) -> dict:
    """The live guardrail configuration, cached for a few seconds.

    A settings write calls `invalidate()` so the change is immediate on the pod that
    served it; the other pods pick it up within the TTL instead of querying per message.
    """
    now = time.time()
    if not force and _cache["cfg"] is not None and now - _cache["at"] < _CONFIG_TTL:
        return _cache["cfg"]
    cfg = normalise(None)
    try:
        import json

        from sqlalchemy import text as _t

        from app.persistence.database import SessionLocal

        with SessionLocal() as s:
            row = s.execute(
                _t("SELECT value FROM system_settings WHERE key = 'guardrails'")
            ).first()
        if row and row[0] is not None:
            val = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            cfg = normalise(val)
    except Exception as exc:  # a broken settings row must never stop the chat
        logger.warning("guardrail config unavailable (%s) — using defaults", exc)
    _cache["cfg"] = cfg
    _cache["at"] = now
    return cfg


def invalidate() -> None:
    _cache["cfg"] = None
    _cache["at"] = 0.0


# ============================================================
# Matching + masking
# ============================================================

_mask_cache: dict = {"key": None, "re": None}


def _compile(defaults: list[str], custom: list[str]) -> re.Pattern | None:
    """One alternation for the whole list.

    Built-in entries are already regexes (`f+u+c+k+` absorbs "fuuuck"); administrator
    entries are literal words, escaped so a stray `+` or `.` cannot change the match.
    ASCII words get word boundaries; anything else (Burmese, Chinese, emoji) is matched
    as-is, because `\\b` needs `\\w` neighbours those scripts do not provide.
    """
    # `(?:ing|ed|er|s…)` after each built-in root: "fucking"/"shitted" must match, not
    # just the bare word — the suffix sits INSIDE the boundary so nothing is half-hidden.
    parts: list[str] = [
        f"(?<![\\w])(?:{p})(?:s|es|ed|ing|er|ers|y|ty)?(?![\\w])" for p in defaults
    ]
    for w in custom:
        if not w:
            continue
        if w.isascii() and re.fullmatch(r"[\w\- ']+", w):
            parts.append(f"(?<![\\w]){re.escape(w)}(?![\\w])")
        else:
            parts.append(re.escape(w))
    if not parts:
        return None
    try:
        return re.compile("|".join(parts), re.IGNORECASE)
    except re.error as exc:
        logger.warning("bad guardrail word list (%s) — ignoring", exc)
        return None


def profanity_regex(cfg: dict | None = None) -> re.Pattern | None:
    cfg = cfg or load_config()
    defaults = DEFAULT_PROFANITY if cfg.get("use_default_list", True) else []
    custom = [w for w in cfg.get("custom_words", []) if w]
    key = (tuple(defaults), tuple(custom))
    if _mask_cache["key"] != key:
        _mask_cache["re"] = _compile(list(defaults), custom)
        _mask_cache["key"] = key
    return _mask_cache["re"]


def _mask_word(match: re.Match, char: str) -> str:
    """Keep the first character so the sentence still reads, hide the rest."""
    word = match.group(0)
    if len(word) <= 1:
        return char * len(word)
    return word[0] + char * (len(word) - 1)


def mask_text(text: str, cfg: dict | None = None) -> tuple[str, int]:
    """Replace every configured word in `text`. Returns (masked, hits)."""
    if not text:
        return text, 0
    cfg = cfg or load_config()
    rx = profanity_regex(cfg)
    if rx is None:
        return text, 0
    char = cfg.get("mask_char") or "*"
    mask = lambda m: _mask_word(m, char)  # noqa: E731 — one-liner lambda keeps the hot path flat
    masked, n = rx.subn(mask, text)
    return masked, n


def contains_profanity(text: str, cfg: dict | None = None) -> bool:
    if not text:
        return False
    rx = profanity_regex(cfg)
    return bool(rx and rx.search(text))


# ============================================================
# Input screening
# ============================================================

@dataclass
class GuardrailResult:
    action: str        # "pass" | "blocked" | "flagged" | "masked"
    type: str          # "injection" | "overflow" | "pii" | "profanity" | "toxic" | "none"
    reason: str
    masked: str | None = None   # what to send on with, when action == "masked"


def check_input(message: str) -> "GuardrailResult":
    """Screen a user chat message. Returns a GuardrailResult verdict.

    Order matters: overflow (cheap) → injection → PII (both always blocked) →
    profanity (masked or refused, per config) → toxicity (always refused).
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

    cfg = load_config()

    # 4) Profanity — mask (and answer) or refuse, per the administrator's choice
    if cfg.get("enabled", True):
        rx = profanity_regex(cfg)
        if rx is not None:
            m = rx.search(message)
            if m:
                hits = len(rx.findall(message))
                if cfg.get("mode") == "block":
                    return GuardrailResult("flagged", "profanity",
                                           f"abusive language: '{m.group(0)[:30]}' ({hits} hit(s))")
                masked, _ = mask_text(message, cfg)
                return GuardrailResult("masked", "profanity",
                                       f"masked {hits} profane term(s), first: '{m.group(0)[:30]}'",
                                       masked=masked)

    # 5) Toxicity / abuse — flag (refuse at LLM via system prompt; record event)
    for pat in _TOXIC_PATTERNS:
        if re.search(pat, message, re.IGNORECASE):
            return GuardrailResult("flagged", "toxic", f"abusive language: '{pat[:30]}…'")

    return GuardrailResult("pass", "none", "")


# ============================================================
# Output filtering
# ============================================================

HOLD_BACK = 48   # characters kept in the buffer — longer than the longest maskable word


class StreamFilter:
    """Masks profanity in a token stream without splitting a word across two sends.

    The tail of each chunk is held back until a space proves no word straddles the
    boundary; `flush()` releases what is left when the stream ends.
    """

    def __init__(self, cfg: dict | None = None):
        self.cfg = cfg or load_config()
        self.enabled = bool(self.cfg.get("enabled", True) and self.cfg.get("output_filter", True))
        self.buf = ""
        self.hits = 0

    def feed(self, chunk: str) -> str:
        if not self.enabled or not chunk:
            return chunk
        self.buf += chunk
        if len(self.buf) <= HOLD_BACK:
            return ""
        cut = len(self.buf) - HOLD_BACK
        space = self.buf.find(" ", cut)
        if space == -1:
            return ""
        out, self.buf = self.buf[: space + 1], self.buf[space + 1:]
        masked, n = mask_text(out, self.cfg)
        self.hits += n
        return masked

    def flush(self) -> str:
        if not self.enabled or not self.buf:
            return ""
        masked, n = mask_text(self.buf, self.cfg)
        self.hits += n
        self.buf = ""
        return masked


def filter_output(text: str) -> str:
    """Mask a complete answer (used before it is written to the conversation)."""
    cfg = load_config()
    if not (cfg.get("enabled", True) and cfg.get("output_filter", True)):
        return text
    masked, _ = mask_text(text, cfg)
    return masked
