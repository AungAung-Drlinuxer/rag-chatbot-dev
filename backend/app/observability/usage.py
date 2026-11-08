"""Durable LLM usage — the table behind the in-app observability page.

Prometheus counters answer "how fast is it right now"; they cannot answer "what did last
month cost", because they live in process memory and reset on every restart. Each answered
question therefore writes one row here, best-effort: a metrics problem must never fail a chat
answer, so every failure is logged and swallowed.
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

logger = logging.getLogger("observability.usage")


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """USD for one answer, using the same price table the Prometheus counter uses.

    One price table, not two: a cost figure on the dashboard that disagrees with the
    /metrics counter is worse than no figure at all.
    """
    try:
        from app.observability.metrics import MODEL_PRICING_PER_1M

        rates = MODEL_PRICING_PER_1M.get(model or "", MODEL_PRICING_PER_1M["default"])
        return (input_tokens / 1_000_000 * rates["input"]) + (
            output_tokens / 1_000_000 * rates["output"]
        )
    except Exception:  # pragma: no cover - pricing table is optional
        return 0.0


def record_usage(
    *,
    model: str | None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: int | None = None,
    decision: str | None = None,
    domain: str | None = None,
    session_id: str | None = None,
    username: str | None = None,
    stages: dict | None = None,
) -> None:
    """Insert one usage row. Never raises."""
    try:
        from sqlalchemy import text

        from app.persistence.database import SessionLocal

        model_key = model or "default"
        cost = estimate_cost(model_key, int(input_tokens), int(output_tokens))
        with SessionLocal() as s:
            s.execute(
                text(
                    "INSERT INTO llm_usage (session_id, username, model, input_tokens, "
                    "output_tokens, cost_usd, latency_ms, decision, domain, stages) "
                    "VALUES (CAST(:sid AS uuid), :u, :m, :ti, :to, :c, :l, :d, :dom, :st)"
                ),
                {
                    "sid": session_id,
                    "u": username,
                    "m": model_key[:96],
                    "ti": int(input_tokens or 0),
                    "to": int(output_tokens or 0),
                    "c": round(cost, 6),
                    "l": latency_ms,
                    "d": decision,
                    "dom": domain,
                    "st": json.dumps(stages) if stages else None,
                },
            )
            s.commit()
    except Exception as exc:  # noqa: BLE001
        # A failed usage row must not surface to the user, but it must be visible to an
        # operator: without it the observability page silently under-reports spend.
        logger.warning("usage row skipped (%s): %s", type(exc).__name__, exc)


def utc_today() -> datetime:
    return datetime.now(UTC)
