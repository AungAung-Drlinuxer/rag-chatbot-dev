"""In-app observability — the Prometheus/Grafana panels, computed from our own database.

WHY THIS EXISTS
---------------
The Grafana boards were useful but needed an external LGTM stack to answer questions the
application already knows the answer to. Every figure here comes from tables the app writes:
`llm_usage` (tokens, cost, latency, decision), `audit_log` (guardrail events), `kb_meta`,
`jira_tickets`, `users`.

WHAT IT DELIBERATELY DOES NOT CLAIM
-----------------------------------
Node CPU, container memory, pod restarts and cAdvisor numbers are not in the database and
cannot be reconstructed from it. They are absent rather than faked; `/api/dashboard/health`
still reports whether each dependency answers, which is the part an operator acts on.

Ranges are half-open on the LEFT edge and inclusive on the right (`created_at >= start`), so
two adjacent windows never both count the same row.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from app.auth.deps import get_current_user
from app.auth.rbac import get_role, permissions_for, require_cap
from app.persistence.database import SessionLocal

router = APIRouter(prefix="/api")


def _window(days: int, start: str | None, end: str | None) -> tuple[datetime, datetime, str]:
    now = datetime.now(UTC)
    if start or end:
        try:
            s = datetime.fromisoformat(start).replace(tzinfo=UTC) if start else now - timedelta(days=7)
            e = datetime.fromisoformat(end).replace(tzinfo=UTC) if end else now
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="dates must be YYYY-MM-DD") from exc
        # A custom range includes the whole end day: "to 2026-11-08" must cover 08th.
        e = e + timedelta(days=1) if len(end or "") == 10 else e
        if s >= e:
            raise HTTPException(status_code=400, detail="start must be before end")
        if (e - s).days > 366:
            raise HTTPException(status_code=400, detail="range is limited to 366 days")
        label = f"{s.date().isoformat()} → {(e - timedelta(days=1)).date().isoformat()}"
        return s, e, label
    d = max(1, min(int(days or 7), 90))
    return now - timedelta(days=d), now, f"Last {d} days"


@router.get("/observability/overview")
def observability_overview(
    days: int = Query(7, ge=1, le=90),
    start: str | None = None,
    end: str | None = None,
    user: str = Depends(get_current_user),
) -> dict:
    """Everything the usage panels render, in one round trip.

    Scope follows permission, not the request: with `manage_users` the caller sees
    organization-wide spend (the same data as the Audit log); without it they see **their
    own** tokens and cost. A plain user asking "what did I cost?" is a fair question, and
    answering it with a 403 only taught them to stop asking.
    """
    start_ts, end_ts, label = _window(days, start, end)
    perms = permissions_for(user)
    org = bool(perms.get("manage_users"))
    mine = "" if org else " AND username = :user"
    params = {"s": start_ts, "e": end_ts, **({} if org else {"user": user})}

    with SessionLocal() as s:
        usage = s.execute(text(
            "SELECT count(*) AS requests, "
            "       COALESCE(sum(input_tokens), 0) AS tokens_in, "
            "       COALESCE(sum(output_tokens), 0) AS tokens_out, "
            "       COALESCE(sum(cost_usd), 0) AS cost, "
            "       COALESCE(avg(latency_ms), 0) AS avg_ms, "
            "       percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50, "
            "       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95, "
            "       COALESCE(max(latency_ms), 0) AS max_ms "
            f"FROM llm_usage WHERE created_at >= :s AND created_at < :e{mine}"
        ), params).mappings().first() or {"requests": 0, "tokens_in": 0, "tokens_out": 0,
                                          "cost": 0, "avg_ms": 0, "p50": 0, "p95": 0, "max_ms": 0}

        series = [dict(r) for r in s.execute(text(
            "SELECT to_char(d.day, 'YYYY-MM-DD') AS day, "
            "       COALESCE(u.requests, 0) AS requests, "
            "       COALESCE(u.tokens_in, 0) AS tokens_in, "
            "       COALESCE(u.tokens_out, 0) AS tokens_out, "
            "       COALESCE(u.cost, 0)::float AS cost, "
            "       u.p95 AS p95_ms "
            # Buckets are calendar days: both sides are truncated, otherwise a range that
            # starts mid-day puts every bucket at that hour and today's rows fall outside.
            "FROM generate_series(date_trunc('day', CAST(:s AS timestamptz)), "
            "                    date_trunc('day', CAST(:e AS timestamptz) - interval '1 second'), "
            "                    interval '1 day') AS d(day) "
            "LEFT JOIN ("
            "  SELECT date_trunc('day', created_at) AS day, count(*) AS requests, "
            "         sum(input_tokens) AS tokens_in, sum(output_tokens) AS tokens_out, "
            "         sum(cost_usd)::float AS cost, "
            "         percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95 "
            f"  FROM llm_usage WHERE created_at >= :s AND created_at < :e{mine} "
            "  GROUP BY 1"
            ") u ON u.day = d.day ORDER BY d.day"
        ), params).mappings()]

        by_model = [dict(r) for r in s.execute(text(
            "SELECT COALESCE(model, 'default') AS model, count(*) AS requests, "
            "       COALESCE(sum(input_tokens), 0) AS tokens_in, "
            "       COALESCE(sum(output_tokens), 0) AS tokens_out, "
            "       COALESCE(sum(cost_usd), 0)::float AS cost "
            f"FROM llm_usage WHERE created_at >= :s AND created_at < :e{mine} "
            "GROUP BY 1 ORDER BY 4 DESC, 2 DESC"
        ), params).mappings()]

        decisions = [dict(r) for r in s.execute(text(
            "SELECT COALESCE(decision, 'unknown') AS decision, count(*) AS n "
            f"FROM llm_usage WHERE created_at >= :s AND created_at < :e{mine} GROUP BY 1 ORDER BY 2 DESC"
        ), params).mappings()]

        domains = [dict(r) for r in s.execute(text(
            "SELECT COALESCE(domain, 'general') AS domain, count(*) AS n "
            f"FROM llm_usage WHERE created_at >= :s AND created_at < :e{mine} GROUP BY 1 ORDER BY 2 DESC LIMIT 8"
        ), params).mappings()]

        # Guardrail events are durable in audit_log (the Prometheus gauge already reads it),
        # so the security strip survives restarts — unlike a counter scrape.
        guardrails = [dict(r) for r in s.execute(text(
            "SELECT action, count(*) AS n FROM audit_log "
            "WHERE action LIKE 'guardrail.%' AND created_at >= :s AND created_at < :e "
            "GROUP BY 1 ORDER BY 2 DESC"
        ), params).mappings()]

        counts = s.execute(text(
            "SELECT (SELECT count(*) FROM kb_meta) AS kb_articles, "
            "       (SELECT count(*) FROM jira_tickets WHERE COALESCE(status, '') NOT IN ('deleted', 'done')) AS tickets_open, "
            "       (SELECT count(*) FROM users) AS users, "
            "       (SELECT count(*) FROM chat_sessions WHERE started_at >= :s AND started_at < :e) AS sessions"
        ), params).mappings().first()

    def num(v) -> float:
        return float(v) if v is not None else 0.0

    return {
        # `self` means these numbers are the caller's own traffic, and the UI says so.
        "scope": "org" if org else "self",
        "range": {"start": start_ts.isoformat(), "end": end_ts.isoformat(), "label": label},
        "totals": {
            "requests": int(usage["requests"] or 0),
            "tokens_in": int(usage["tokens_in"] or 0),
            "tokens_out": int(usage["tokens_out"] or 0),
            "cost_usd": round(num(usage["cost"]), 6),
            "avg_latency_ms": int(num(usage["avg_ms"])),
            "p50_latency_ms": int(num(usage["p50"])),
            "p95_latency_ms": int(num(usage["p95"])),
            "max_latency_ms": int(num(usage["max_ms"])),
        },
        "series": series,
        "by_model": by_model,
        "decisions": decisions,
        "domains": domains,
        "guardrails": guardrails,
        "guardrail_total": sum(int(g["n"]) for g in guardrails),
        "counts": dict(counts) if counts else {},
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.get("/observability/events")
def observability_events(
    limit: int = Query(50, ge=1, le=200),
    user: str = Depends(get_current_user),
) -> dict:
    """The recent-events table: guardrail and escalation rows, newest first.

    Admin-only: it carries usernames and the question text of refused prompts.
    """
    if get_role(user) != "admin":
        raise HTTPException(status_code=403, detail="Administrator permission required.")
    limit = max(1, min(limit, 200))
    with SessionLocal() as s:
        rows = [dict(r) for r in s.execute(text(
            "SELECT id, action, username, domain, decision, detail, created_at "
            "FROM audit_log WHERE action LIKE 'guardrail.%' "
            "ORDER BY created_at DESC LIMIT :n"
        ), {"n": limit}).mappings()]
    for r in rows:
        r["created_at"] = r["created_at"].isoformat() if r.get("created_at") else None
        act = r.get("action") or ""
        subtype = act.replace("guardrail.", "")
        detail_lower = (r.get("detail") or "").lower()
        if subtype == "injection" or "injection" in detail_lower or "prompt" in detail_lower:
            r["type"] = "Prompt Injection"
            r["risk"] = "Critical"
        elif subtype == "pii" or "pii" in detail_lower or "ssn" in detail_lower:
            r["type"] = "PII Leak Prevented"
            r["risk"] = "Medium"
        elif subtype == "profanity" or "profanity" in detail_lower or "f+u+c+k" in detail_lower or "trash" in detail_lower or "garbage" in detail_lower:
            r["type"] = "Profanity Filter"
            r["risk"] = "Medium"
        elif subtype == "rate_limit" or "rate limit" in detail_lower or "throttled" in detail_lower:
            r["type"] = "API Rate Limit"
            r["risk"] = "Low"
        elif subtype == "overflow":
            r["type"] = "Prompt Overflow"
            r["risk"] = "Medium"
        elif subtype == "toxic":
            r["type"] = "Toxic Language"
            r["risk"] = "High"
        else:
            r["type"] = subtype.title()
            r["risk"] = "Low"
    return {"events": rows}
