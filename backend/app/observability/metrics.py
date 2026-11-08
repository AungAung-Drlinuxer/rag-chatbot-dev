"""Prometheus metrics exporter for LLM & RAG Observability (Production Grade).

Tracks:
1. RAG & LangGraph Stage Latencies (seconds)
2. Token Usage & Incurred Cost ($ estimate per model)
3. Guardrails & Evaluation (Hallucinations, Cautions, Injection/Toxic triggers)
4. User Feedback Loop (Thumbs Up vs Down counts)
"""
from __future__ import annotations

import logging
import threading
import time

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi import Response

logger = logging.getLogger("metrics")

# --- 1. RAG & LLM Latency & Stages ---
RAG_STAGE_LATENCY = Histogram(
    "rag_stage_latency_seconds",
    "Time spent in each RAG & LangGraph stage in seconds",
    ["stage"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 20.0, 30.0, 60.0),
)

LLM_TIME_TO_FIRST_TOKEN = Histogram(
    "llm_time_to_first_token_seconds",
    "Latency before first token arrives from LLM stream (TTFT)",
    ["model"],
    buckets=(0.1, 0.25, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0),
)

# --- 2. Token Usage & Cost Tracking ---
LLM_TOKENS_TOTAL = Counter(
    "llm_tokens_total",
    "Total tokens consumed by LLM operations",
    ["model", "type"],  # type = input | output
)

LLM_COST_DOLLARS_TOTAL = Counter(
    "llm_cost_dollars_total",
    "Estimated total cost in USD based on input/output tokens",
    ["model"],
)

# Standard pricing catalog per 1M tokens (USD)
# Can be updated easily or fall back to sensible standard defaults
MODEL_PRICING_PER_1M = {
    "minimax/minimax-m3:free": {"input": 0.0, "output": 0.0},
    "deepseek/deepseek-chat": {"input": 0.14, "output": 0.28},
    "openai/gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "google/gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "default": {"input": 0.15, "output": 0.60},
}

# --- 3. Guardrails, Quality & Confidence ---
RAG_CONFIDENCE_SCORE = Histogram(
    "rag_confidence_score",
    "Calculated confidence score distribution for retrieval gate (0.0 to 1.0)",
    ["domain"],
    buckets=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1.0),
)

RAG_GATE_DECISIONS = Counter(
    "rag_gate_decisions_total",
    "Number of gate decisions: answer (direct) vs caution (low confidence)",
    ["decision", "domain"],
)

GUARDRAIL_EVENTS_TOTAL = Counter(
    "guardrail_events_total",
    "Security & Guardrail detections (jailbreak/injection, prompt overflow, toxic)",
    ["type", "action"],  # type = injection | overflow | toxic, action = blocked | flagged
)

# --- 4. User Feedback Loop ---
USER_FEEDBACK_TOTAL = Counter(
    "user_feedback_total",
    "User rating feedback for answers",
    ["rating"],  # rating = helpful (+1) | not_helpful (-1)
)

ESCALATION_TICKETS_TOTAL = Counter(
    "escalation_tickets_total",
    "HITL escalation tickets handled",
    ["status"],  # status = approved | rejected
)

# v1.1.5 — chat volume/latency moved from the OTel meter path (dead: MIMIR_OTLP_URL
# was empty, so record_counter/record_histogram were silent no-ops and these two
# series never existed in Prometheus) to prometheus_client, like every other
# dashboard metric.
CHAT_REQUESTS_TOTAL = Counter(
    "chat_requests_total",
    "Completed chat requests",
    ["domain", "decision"],
)

CHAT_LATENCY_SECONDS = Histogram(
    "chat_latency_seconds",
    "End-to-end chat answer latency in seconds",
    ["domain", "decision"],
    buckets=(0.5, 1, 2, 5, 10, 20, 30, 60, 90, 120),
)

def record_token_and_cost(model: str, input_tokens: int, output_tokens: int) -> None:
    """Increment token counters and calculate incurred cost."""
    try:
        model_key = model or "default"
        LLM_TOKENS_TOTAL.labels(model=model_key, type="input").inc(input_tokens)
        LLM_TOKENS_TOTAL.labels(model=model_key, type="output").inc(output_tokens)

        rates = MODEL_PRICING_PER_1M.get(model_key, MODEL_PRICING_PER_1M["default"])
        cost = (input_tokens / 1_000_000 * rates["input"]) + (output_tokens / 1_000_000 * rates["output"])
        LLM_COST_DOLLARS_TOTAL.labels(model=model_key).inc(cost)
    except Exception as e:
        logger.debug("Failed to record tokens/cost metric: %s", e)


# --- v1.1.6 — DB-backed security gauges -------------------------------------
# Per-pod Prometheus counters reset/die on HPA churn, so sum(increase(...[6h]))
# over 25 churned series inflated "Blocked Attacks" to 996 while the true total
# was 43. The durable source of truth is the audit_log table — these gauges are
# refreshed from it every 30s (single process-wide refresh, guarded by a lock)
# and expose EXACT lifetime counts regardless of pod restarts.
SECURITY_EVENTS_DB_TOTAL = Gauge(
    "security_events_db_total",
    "Exact lifetime guardrail events from the durable audit_log table",
    ["type", "action"],
)

_db_gauge_lock = threading.Lock()
_db_gauge_last_refresh = 0.0


def refresh_security_gauges(force: bool = False) -> None:
    """Reload guardrail event counts from audit_log into gauges. Rate-limited."""
    global _db_gauge_last_refresh
    now = time.time()
    if not force and now - _db_gauge_last_refresh < 30:
        return
    with _db_gauge_lock:
        if now - _db_gauge_last_refresh < 30 and not force:
            return
        try:
            from sqlalchemy import text

            from app.persistence.database import SessionLocal
            with SessionLocal() as s:
                rows = s.execute(text(
                    "SELECT action, count(*) FROM audit_log "
                    "WHERE action LIKE 'guardrail%' GROUP BY action"
                )).all()
            # reset all known series first so deleted rows reflect too
            for t in ("injection", "overflow", "toxic"):
                for a in ("blocked", "flagged"):
                    SECURITY_EVENTS_DB_TOTAL.labels(type=t, action=a).set(0)
            for action, cnt in rows:
                # action = 'guardrail.injection' etc.; counter action from type:
                # injection/overflow => blocked, toxic => flagged
                t = action.replace("guardrail.", "")
                a = "flagged" if t == "toxic" else "blocked"
                SECURITY_EVENTS_DB_TOTAL.labels(type=t, action=a).set(int(cnt))
            _db_gauge_last_refresh = now
        except Exception as e:
            logger.debug("security gauge refresh skipped: %s", e)


def metrics_endpoint() -> Response:
    """Endpoint serving prometheus metrics for scraping."""
    # v1.1.6 — refresh DB-backed security gauges before serving (rate-limited 30s)
    try:
        refresh_security_gauges()
    except Exception:
        pass
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
