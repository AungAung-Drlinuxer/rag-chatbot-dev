"""Runtime-tunable settings (Phase 10.1).

The admin can change a subset of knobs from the Settings UI without re-deploying.
We store the override in `runtime_kv` (Postgres) and read at request time. If no
override is set, we fall back to the env-derived default in `config.SETTINGS`.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from app.persistence.database import SessionLocal
from app.persistence.models import RuntimeKv

logger = logging.getLogger("runtime")

# Whitelisted keys + their typed converter + default. Anything else is rejected.
# (env key, default) pairs mirror config.py; converters turn strings into the
# right Python type at read time.
DEFS: dict[str, tuple[Callable[[str], Any], Any]] = {
    "retrieval_top_k":        (int, 5),
    "confidence_gate_threshold": (float, 0.75),
    "max_context_tokens":     (int, 60000),
    "chunk_tokens":           (int, 800),
    "chunk_overlap":          (float, 0.10),
    "embed_batch_size":       (int, 32),
}


def all_overrides() -> dict[str, Any]:
    """Return all currently-set runtime overrides (as a dict)."""
    out: dict[str, Any] = {}
    s = SessionLocal()
    try:
        for k, (conv, default) in DEFS.items():
            row = s.get(RuntimeKv, k)
            out[k] = conv(row.value) if row else default
    finally:
        s.close()
    return out


def get(key: str) -> Any:
    """Return the runtime override for `key` or its default (from DEFS)."""
    if key not in DEFS:
        raise KeyError(f"runtime key {key!r} is not whitelisted")
    conv, default = DEFS[key]
    s = SessionLocal()
    try:
        row = s.get(RuntimeKv, key)
        return conv(row.value) if row else default
    finally:
        s.close()


def set_(key: str, value: Any) -> None:
    """Persist a runtime override. Validates against the whitelisted DEFS."""
    if key not in DEFS:
        raise KeyError(f"runtime key {key!r} is not whitelisted")
    conv, _ = DEFS[key]
    # Round-trip through the converter to ensure type validity + a canonical form.
    str_value = str(conv(str(value)))
    s = SessionLocal()
    try:
        row = s.get(RuntimeKv, key)
        if row:
            row.value = str_value
        else:
            s.add(RuntimeKv(key=key, value=str_value))
        s.commit()
    finally:
        s.close()
    logger.info(f"runtime override set: {key}={str_value}")


def reset(key: str) -> None:
    """Drop the override for `key` (returns to the env default)."""
    s = SessionLocal()
    try:
        row = s.get(RuntimeKv, key)
        if row:
            s.delete(row)
            s.commit()
            logger.info(f"runtime override reset: {key}")
    finally:
        s.close()


def metadata() -> list[dict]:
    """Schema for the admin UI: whitelisted keys, their types, current values."""
    out = []
    for k, (conv, default) in DEFS.items():
        current = get(k)
        out.append({
            "key": k,
            "type": conv.__name__,
            "default": default,
            "current": current,
            "overridden": current != default,
        })
    return out
