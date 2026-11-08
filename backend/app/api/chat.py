from __future__ import annotations

from app.schemas import ChatRequest, EscalateRequest, FeedbackRequest

import json
import os
import time
import uuid
from contextlib import contextmanager, suppress

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.auth.deps import get_current_user
from app.api.auth import _require_chatbot
from app.auth.rbac import get_role, require_role, allowed_domains
from app.config import SETTINGS
from app.observability.audit import audit
from app.observability.telemetry import start_span
from app.security.rate_limit import limit
from app.persistence.models import ChatMessage, ChatSession, Feedback
from app.persistence.database import SessionLocal
from app.orchestration.orchestrator import run_rag
from app.auth.rbac import jira_route
from app.rag.gate import DECISION_CAUTION, caution_message
from app.rag.retrieval import build_context
from app.integrations.contacts import get_contact
from app.integrations.jira import escalate as jira_escalate
from app.llm.client import stream_answer
from app.schemas import EscalationsResponse, FeedbackResponse
import logging
logger = logging.getLogger("chat")

router = APIRouter()

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _stage_emitter():
    """Yield stage SSE frames, dropping CONSECUTIVE duplicates.

    WHY: two graph nodes map to the same UI stage (context and tools both render as
    "generate"), and chat.py announces "understanding" before the graph's classify node
    also reports it. The tracker therefore showed
    ['understanding','understanding',...,'generate','generate','tools','generate'] —
    the same step twice, which reads as the pipeline running twice. Only consecutive
    repeats are collapsed, so a genuine non-adjacent re-run (the retrieval retry loop)
    still shows.
    """
    last = {"key": None}

    def emit(stage_key: str, detail: str) -> str | None:
        if stage_key == last["key"]:
            return None
        last["key"] = stage_key
        return _sse("stage", {"stage": stage_key, "detail": detail})

    return emit


def _chunk_text(text: str, size: int = 40):
    """Yield answer text in small chunks (SSE token streaming feel)."""
    for i in range(0, len(text), size):
        yield text[i:i + size]


@router.post("/api/chat/stream")
@limit("chat")
def chat_stream(req: ChatRequest, user: str = Depends(_require_chatbot)) -> StreamingResponse:
    """Design doc §3 single pipeline, streamed over SSE.

    Events: meta (domain/confidence/decision/hits) → token* → done.
    """
    _emit_stage = _stage_emitter()
    raw_sid = req.session_id or str(uuid.uuid4())
    try:
        session_id = str(uuid.UUID(raw_sid))
    except (ValueError, AttributeError):
        session_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, raw_sid))

    def gen():
        t0 = time.time()

        # v1.1.4 — INPUT GUARDRAILS (prompt injection / overflow / toxicity).
        # Deterministic screening BEFORE any LLM cost or DB write.
        guardrail_flag = None
        try:
            from app.security.guardrails import check_input
            verdict = check_input(req.message)
            if verdict.action in ("blocked", "flagged"):
                from app.observability.metrics import GUARDRAIL_EVENTS_TOTAL
                GUARDRAIL_EVENTS_TOTAL.labels(type=verdict.type, action=verdict.action).inc()
                logger.warning("GUARDRAIL %s (%s) user=%s: %s",
                               verdict.action, verdict.type, user, verdict.reason)
                try:
                    audit("guardrail." + verdict.type, user, detail=verdict.reason[:120])
                except Exception:
                    pass
                if verdict.action == "blocked":
                    yield _sse("caution", {
                        # v1.6.6 — professional tone for blocked messages too
                        "message": ("I couldn't process that request — it looks like it "
                                    "contains content our security policy doesn't allow "
                                    f"({verdict.type}). If you're trying to reach IT "
                                    "support, please rephrase your question and I'll be "
                                    "glad to help."),
                        "blocked": True, "type": verdict.type})
                    yield _sse("done", {"message_id": "", "latency_ms": 0,
                                        "guardrail": verdict.type})
                    return
                # v1.6.6 — flagged (toxic): reply immediately with a calm,
                # professional de-escalation. The old path burned a full LLM call
                # (107s on CPU fallback); this stays deterministic, instant,
                # zero cost — but now keeps a service-desk tone instead of a
                # blunt "I can't help with that."
                _refusal = (
                    "I want to make sure you get the support you need, but I can't "
                    "respond to messages with that tone. I'm here to help with "
                    "passwords, VPN access, hardware issues, and any other IT "
                    "requests — just let me know what you need and I'll get right on it."
                )
                yield _sse("caution", {"message": _refusal, "flagged": True, "type": verdict.type})
                yield _sse("token", {"token": _refusal})
                yield _sse("done", {"message_id": "", "latency_ms": int((time.time() - t0) * 1000),
                                    "guardrail": verdict.type})
                return
        except Exception as guardrail_err:
            # Never break the chat on guardrail machinery failure
            logger.warning("guardrail check failed (%s) — allowing request", guardrail_err)

        # Persist the user turn (best-effort; must not break the stream).
        #
        # The session is released in a `finally`: this block runs on the hot path of
        # every question, so a session leaked here is a pool connection lost per
        # failed persist. `s = None` in the handler (the old form) closed nothing.
        s = None
        try:
            from app.persistence.database import SessionLocal
            s = SessionLocal()
            sess = s.get(ChatSession, session_id)
            if sess is None:
                # S1.3 — derive a real title from the first question (deterministic,
                # no LLM call) so the sidebar never falls back to a raw truncated
                # question and duplicate-looking rows.
                from app.textutil import auto_title
                sess = ChatSession(id=session_id, username=user,
                                   title=auto_title(req.message))
                s.add(sess)
                s.flush()  # ensure session row exists before the FK'd message insert
            # Persist the scope with the conversation, not with the message: the picker
            # is conversation-level, so reopening the chat must restore it — and a scope
            # chosen mid-conversation must survive the next question.
            #
            # Validated, because this value becomes a scope on every later turn.
            s.add(ChatMessage(session_id=session_id, role="user", content=req.message))
            s.commit()
        except Exception as exc:
            logger.warning(f"persist user turn skipped ({type(exc).__name__}): {exc}")
        finally:
            if s is not None:
                with suppress(Exception):  # never let cleanup break the stream
                    s.close()

        # --- Small talk shortcut ---------------------------------------------------
        # "Hi" used to run the whole RAG pipeline: retrieval found nothing relevant, the
        # model answered the greeting from stray context, and the UI listed KB articles
        # under it. A greeting gets a greeting — no retrieval, no model call, no
        # confidence score (a percentage about document relevance is meaningless here).
        # Whole-message matches only, so "hi how do I reset my VPN password" still
        # reaches retrieval.
        _st = None
        try:
            from app.smalltalk import classify as _classify_small_talk
            from app.smalltalk import reply as _small_talk_reply

            _st = _classify_small_talk(req.message)
        except Exception as _st_err:  # never break chat on this path
            logger.warning("small talk check failed (%s) — continuing to RAG", _st_err)
            _st = None

        if _st:
            from app.smalltalk import reply as _small_talk_reply  # imported here: the guard above may have failed
            _st_answer = _small_talk_reply(_st)
            _st_meta = {
                "domain": "general",
                "confidence": None,
                "decision": "small_talk",
                "tool_used": None,
                "rewritten": req.message,
                "hits": [],
                "top_k": 0,
                "retrieval": {
                    "chunks": 0, "cited": 0, "top_k": 0,
                    "rerank_used": False, "acl_scoped": False,
                    "role": get_role(user),
                },
                # ChatRequest carries llm_provider, not "mode": reading an attribute the
                # schema never defines raised inside the generator, after the response had
                # started, which surfaced to the browser as an empty stream (HTTP 520).
                "mode": (req.llm_provider or "auto").strip().lower(),
                "small_talk": _st,
            }
            yield _sse("meta", _st_meta)
            for _chunk in _chunk_text(_st_answer, 24):
                yield _sse("token", {"token": _chunk})
                time.sleep(0.012)

            _st_msg_id = ""
            _s2 = None
            try:
                from app.persistence.database import SessionLocal as _SessionLocal

                _s2 = _SessionLocal()
                _am = ChatMessage(session_id=session_id, role="assistant",
                                  content=_st_answer, meta=json.dumps(_st_meta))
                _s2.add(_am)
                _s2.commit()
                _st_msg_id = str(_am.id)
            except Exception as _st_persist_err:
                logger.warning("persist small talk answer skipped (%s): %s",
                               type(_st_persist_err).__name__, _st_persist_err)
            finally:
                if _s2 is not None:
                    with suppress(Exception):
                        _s2.close()

            try:
                audit("chat", user, "general", 1.0, "small_talk")
            except Exception:
                pass
            yield _sse("done", {
                "message_id": _st_msg_id or str(uuid.uuid4()),
                "latency_ms": int((time.time() - t0) * 1000),
                "small_talk": _st,
            })
            return

        # Stage feedback (v0.16.4): tell the client what the pipeline is doing so the
        # user sees progress instead of silence during retrieval + rerank.
        _f = _emit_stage("understanding", "Analyzing your question")
        if _f:
            yield _f

        # v1.1.9 — MONITORING NL QUERY TOOL: Zabbix devices/servers + K8s/LGTM app status.
        # Deterministic intent match; answers real-time data without touching the KB/LLM path
        # (fast, accurate, rate-limit friendly).
        import re as _re
        _msg_l = req.message.lower()


        # v0.21.70 — LangGraph orchestration (retry loop on weak retrieval).
        # Falls back to the linear pipeline if the graph fails for any reason.
        result = None
        graph_pending = False
        if os.environ.get("LANGGRAPH_ENABLED", "1") == "1":
            try:
                from app.graph_rag import run_rag_graph_stream
                from app.orchestration.orchestrator import RAGOrchestrationResult

                g: dict = {}
                # v1.6.16 — node name → canonical frontend stage key so the
                # pipeline tracker can time each stage exactly.
                _NODE_STAGE = {
                    "classify": "understanding",
                    "rewrite": "rewrite",
                    "retrieve": "retrieve",
                    "gate": "rerank",
                    "context": "generate",
                    # NOTE: `tools` stays mapped to "generate" here on purpose. The
                    # graph runs this node on EVERY request (it decides whether to
                    # escalate), so emitting its node-stage as "tools" made a plain
                    # documents answer render the live step set — measured:
                    # ['...', 'generate', 'tools', 'retrieve', 'generate'] for mode=kb.
                    # The distinct live stage is emitted below, from the one place that
                    # actually knows the answer came from the estate.
                    "tools": "generate",
                }
                # aliases for the post-graph chat.py-emitted events
                def _canon_stage(s: str) -> str:
                    return {"retrieval": "retrieve", "generating": "generate"}.get(s, s)
                for ev in run_rag_graph_stream(req.message, history=req.context,
                                               top_k=req.top_k, user=user,
                                               thread_id=session_id):
                    if isinstance(ev, tuple) and ev[0] == "__FINAL__":
                        g = ev[1]
                    elif isinstance(ev, tuple) and len(ev) == 2:
                        _f = _emit_stage(_NODE_STAGE.get(ev[0], "graph"), ev[1])
                        if _f:
                            yield _f
                    else:
                        # Unknown event shape: previously streamed the raw repr of the
                        # event to the user, which leaked internal tuple text into the
                        # progress detail. Keep it on the server log instead.
                        logger.debug("graph event: %r", ev)
                graph_pending = bool(g.get("pending_approval"))
                graph_thread = req.session_id
                result = RAGOrchestrationResult(
                    domain=g["domain"], rewritten=g["rewritten"], docs=g["docs"],
                    confidence=g["confidence"], decision=g["decision"],
                    context=g["context"], sources=[
                        {"page_id": d.get("page_id"), "title": d["title"],
                         "confidence": d.get("confidence"), "source_url": d.get("source_url"),
                         "relevance": d.get("confidence")}
                        for d in g["docs"]
                    ], tool_used=g.get("tool_used"), tool_rows=g.get("ticket_rows") or [],
                    # v1.6.55 — carry the OUTCOME, not just whether a tool ran. Without
                    # this the meta fell back to "ok" whenever tool_used was set, so a
                    # failed infrastructure lookup was reported to the UI as success.
                    tool_note=g.get("tool_note"),
                    tool_calls=g.get("tool_calls") or [],
                    raw_output=(g.get("raw_output") or "")[:20000],
                    top_k=g["top_k"] or 5,
                    context_chars=len(g["context"]),
                    context_tokens_estimate=len(g["context"]) // 4,
                    context_truncated=False,
                )
                # v0.21.90 — ticket tool answered from the live DB: drop KB docs so
                # the UI shows ticket rows only (same contract as the linear path).
                if result.tool_used == "tickets" and result.tool_rows:
                    result.docs = []
                    result.sources = []
                    result.confidence = max(result.confidence, 0.95)
                _detail = ("Ticket status lookup (live)"
                           if result.tool_used == "tickets"
                           else (f"LangGraph pass {g['retries']} — "
                                 f"confidence {g['confidence']:.0%}"))
                _f = _emit_stage(_canon_stage("retrieval"), _detail)
                if _f:
                    yield _f
            except Exception as graph_err:
                logger.warning("langgraph path failed (%s) — falling back to linear pipeline", graph_err)
                result = None
        if result is None:
            result = run_rag(req.message, history=req.context, top_k=req.top_k, user=user)
        else:
            # v0.21.70 Phase 2 — graph paused for human approval?
            if graph_pending:
                import uuid as _uuid
                approval_id = str(_uuid.uuid4())
                from sqlalchemy import text as _txt
                from app.persistence.database import SessionLocal as _SL
                with _SL() as _s:
                    _s.execute(_txt(
                        "INSERT INTO approvals (id, username, question, status, created_at, thread_id) "
                        "VALUES (:i, :u, :q, 'pending', NOW(), :tid)"
                    ), {"i": approval_id, "u": user, "q": req.message, "tid": req.session_id})
                    _s.commit()
                # v0.21.92 — alert admins (SMTP) that an escalation awaits review
                try:
                    from app.notifier import send_alert
                    send_alert(
                        "approval_request",
                        "[iTH] Escalation awaiting approval",
                        f"User: {user}\nQuestion: {req.message}\n"
                        f"Approve/reject in Chat → approval queue.\n",
                        to_admins=True,
                    )
                except Exception:  # noqa: BLE001
                    pass
                yield _sse("approval_request", {
                    "approval_id": approval_id,
                    "thread_id": req.session_id,
                    "question": req.message,
                    "detail": "Escalation needs administrator approval",
                })
                yield _sse("done", {"message_id": str(_uuid.uuid4()),
                                    "latency_ms": int((time.time() - t0) * 1000)})
                return
        _f = _emit_stage(_canon_stage("generating"), "Generating answer")
        if _f:
            yield _f

        # Domain-scoped access (Phase 9): non-admin users only see their allowed domains.
        role = get_role(user)
        allowed = allowed_domains(role)
        if allowed is not None and result.domain not in allowed:
            result.decision = DECISION_CAUTION
            audit("domain_blocked", user, result.domain, result.confidence, detail=f"role={role}")

        # meta event — domain badge + confidence + retrieved sources + LLM-stage telemetry
        meta = {
            "domain": result.domain,
            "confidence": result.confidence,
            "decision": result.decision,
            "tool_used": result.tool_used,
            "rewritten": result.rewritten,
            # v0.18.4 — tool-answered questions show the tool's rows as sources
            # (never mix ticket rows with KB hits)
            "hits": (result.tool_rows if result.tool_used == "tickets" and result.tool_rows
                     else result.sources),
            # New: context-window + retriever tunables (visible to the UI)
            "top_k": result.top_k,
            "context_chars": result.context_chars,
            "context_tokens_estimate": result.context_tokens_estimate,
            "context_truncated": result.context_truncated,
            "max_context_tokens": int(SETTINGS.max_context_tokens),
            # S1.1 — REAL retrieval telemetry for the right-hand panel. Previously the
            # UI hardcoded "Hybrid + rerank" / "Enabled" and derived both counters from
            # the source list, so it reported "Chunks retrieved: 0" while citing sources.
            "retrieval": {
                "chunks": len(result.docs or []),
                "cited": len(result.sources or []),
                "top_k": result.top_k,
                "rerank_used": any(d.get("rerank_score") is not None
                                   for d in (result.docs or [])),
                "acl_scoped": allowed is not None,
                "role": role,
            },
        }
        if guardrail_flag:
            meta["guardrail_flagged"] = guardrail_flag  # toxic-abuse marker for audit/UI
        meta["llm_provider"] = (req.llm_provider or "auto").strip().lower()  # v1.6.22 — echo requested provider
        yield _sse("meta", meta)

        if result.decision == DECISION_CAUTION and not result.tool_used:
            yield _sse("caution", {"message": caution_message(), "confidence": result.confidence})

        # Models Provider generation (doc §3 ⑥). Answer = the assembled briefing.
        # `stream_answer` now yields (token, usage) pairs; usage is non-None only on the
        # LAST pair (a zero-length sentinel) so the consumer can pick it up exactly once.
        context = result.context or build_context(result.docs, result.rewritten)

        # v1.6.58 — a deterministic infrastructure lookup already produced an
        # authoritative, formatted answer, so stream it verbatim instead of asking a
        # (weak, free-tier) model to re-phrase cluster output. Measured: given the same
        # data as context the model replied "I couldn't find information … in the
        # knowledge base or live infrastructure data" and dropped the result. Routing
        # it around generation removes that failure mode entirely.
        if getattr(result, "tool_note", None) == "deterministic" and context:
            for _chunk in _chunk_text(context, 120):
                yield _sse("token", {"token": _chunk})
            # Use the MODULE-level uuid (line 8). `_uuid` is imported inside a nested
            # branch further up, so on this path it is unbound and raised NameError —
            # which killed the generator mid-stream and surfaced in the UI as
            # "Connection error — please try again" with the answer already printed.
            yield _sse("done", {"message_id": str(uuid.uuid4()),
                                "latency_ms": int((time.time() - t0) * 1000)})
            return

        answer_parts: list[str] = []
        last_usage: dict | None = None
        from app.llm.client import get_active_model_name
        active_llm_model = get_active_model_name()

        # v1.1.1 — SERVER-kind request span so the Tempo service graph has a node
        # (the servicegraph connector only pairs CLIENT/SERVER span kinds).
        from app.observability.telemetry import start_quiet_span
        # start_quiet_span: SSE generator resumes in a different contextvars
        # Context per yield -> plain start_as_current_span logs a harmless
        # "Failed to detach context" ValueError on close. _quiet_span swallows it.
        with start_quiet_span("chat.request", kind="SERVER") as req_span:
            req_span.set_attribute("chat.domain", result.domain or "general")
            with start_span("chat.stream.llm") as span:
                span.set_attribute("rag.confidence", result.confidence)
                span.set_attribute("rag.decision", result.decision)
                span.set_attribute("llm.model", active_llm_model)
                for tok, usage in stream_answer(req.message, context, llm_provider=req.llm_provider):
                    if usage is not None:
                        # The last (zero-length) token carries the final usage dict.
                        last_usage = usage
                        continue
                    if not tok:
                        continue
                    answer_parts.append(tok)
                    yield _sse("token", {"token": tok})
                if last_usage is not None:
                    span.set_attribute("llm.input_tokens", last_usage.get("input_tokens", 0))
                    span.set_attribute("llm.output_tokens", last_usage.get("output_tokens", 0))
                    span.set_attribute("llm.total_tokens", last_usage.get("total_tokens", 0))

        answer = "".join(answer_parts)
        # Stamp LLM usage + RAG tunables onto the persisted meta so they survive
        # conversation reloads (the SSE `meta` event has the live ones, but we
        # store a snapshot too so a re-opened chat can show usage under old answers).
        if last_usage is not None:
            meta["usage"] = last_usage
        meta["top_k"] = result.top_k
        meta["context_tokens_estimate"] = result.context_tokens_estimate
        meta["context_chars"] = result.context_chars
        if s is not None:
            try:
                _am = ChatMessage(session_id=session_id, role="assistant", content=answer, meta=json.dumps(meta))
                s.add(_am)
                s.commit()
                db_msg_id = str(_am.id)  # v0.21.90 — real row id so feedback can reference it
            except Exception as exc:
                db_msg_id = ""
                logger.warning(f"persist assistant turn skipped ({type(exc).__name__}): {exc}")
            finally:
                with suppress(Exception):
                    s.close()

        message_id = db_msg_id or str(uuid.uuid4())
        from app.observability.metrics import CHAT_REQUESTS_TOTAL, CHAT_LATENCY_SECONDS
        CHAT_REQUESTS_TOTAL.labels(domain=result.domain or "general", decision=result.decision).inc()
        CHAT_LATENCY_SECONDS.labels(domain=result.domain or "general", decision=result.decision).observe(time.time() - t0)
        audit("chat", user, result.domain, result.confidence, result.decision)

        # Record LLM Observability Metrics (Tokens, Cost, Confidence Gate)
        try:
            from app.observability.metrics import (
                RAG_CONFIDENCE_SCORE,
                RAG_GATE_DECISIONS,
                record_token_and_cost,
            )
            RAG_CONFIDENCE_SCORE.labels(domain=result.domain or "general").observe(result.confidence)
            RAG_GATE_DECISIONS.labels(decision=result.decision, domain=result.domain or "general").inc()
            if last_usage is not None:
                record_token_and_cost(
                    model=active_llm_model,
                    input_tokens=int(last_usage.get("input_tokens", 0)),
                    output_tokens=int(last_usage.get("output_tokens", 0)),
                )
        except Exception as exc:
            logger.debug("Failed to update observability metrics: %s", exc)

        # Durable copy for the in-app observability page: the Prometheus counters above are
        # per-process and reset on restart, so they cannot answer "what did this month cost".
        try:
            from app.observability.usage import record_usage
            record_usage(
                model=active_llm_model,
                input_tokens=int((last_usage or {}).get("input_tokens", 0)),
                output_tokens=int((last_usage or {}).get("output_tokens", 0)),
                latency_ms=int((time.time() - t0) * 1000),
                decision=result.decision,
                domain=result.domain,
                session_id=session_id,
                username=user,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("usage row skipped: %s", exc)

        # Echo LLM usage + RAG tunables on the terminal event so the frontend can
        # show a compact "Usage" pill under the answer.
        done_payload: dict = {"message_id": message_id, "latency_ms": int((time.time() - t0) * 1000)}
        if last_usage is not None:
            done_payload["usage"] = last_usage
        done_payload["top_k"] = result.top_k
        done_payload["context_tokens_estimate"] = result.context_tokens_estimate
        yield _sse("done", done_payload)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.post("/api/escalate")
@limit("escalate")
def escalate(req: EscalateRequest, user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — create a Jira ticket AS the authenticated user (reporter=username)."""
    summary = (req.message or "IT help escalation").strip()[:120]
    transcript = "\n".join(
        f"{m.get('role')}: {m.get('content')}" for m in req.transcript if m.get("content")
    )
    description = (
        f"Domain: {req.domain or 'unknown'}\n"
        f"Confidence: {req.confidence}\n"
        f"Transcript:\n{transcript}"
    )
    try:
        route = jira_route(req.domain)
        result = jira_escalate(summary, description, reporter=user,
                               project=route.get("project") if isinstance(route, dict) else route,
                               assignee=route.get("assignee") if isinstance(route, dict) else None,
                               domain=req.domain)
    except Exception as exc:
        logger.exception("escalate failed")
        result = {"link": "", "mode": "error", "jira_key": None, "reporter": user,
                  "error": f"{type(exc).__name__}: {exc}"}
    audit("escalate", user, req.domain, req.confidence, detail=result.get("jira_key"))

    # Persist the escalation log (best-effort).
    # v1.6.4 — external-only policy: only persist when a REAL Jira key exists;
    # otherwise the caller gets the error and no phantom local-only row is saved.
    if not result.get("jira_key"):
        return {"ok": False, "error": result.get("error")
                or "Jira ticket was not created — check Settings → Integrations",
                **{k: result.get(k) for k in ("link", "mode")}}
    s = None
    try:
        from app.persistence.database import SessionLocal
        from app.persistence.models import JiraTicket

        s = SessionLocal()
        s.add(JiraTicket(session_id=req.session_id, jira_key=result.get("jira_key"),
                         domain=req.domain, status="created", created_by=user))
        s.commit()
    except Exception as exc:
        logger.warning(f"persist jira ticket skipped ({type(exc).__name__}): {exc}")
    finally:
        if s is not None:
            with suppress(Exception):
                s.close()

    return result


@router.post("/api/feedback", response_model=FeedbackResponse)
def feedback(req: FeedbackRequest, user: str = Depends(get_current_user)) -> dict:
    """Record Helpful / Not Helpful (design doc §7)."""
    from app.persistence.database import SessionLocal

    s = SessionLocal()
    try:
        fb = Feedback(message_id=req.message_id, rating=req.rating, comment=req.comment)
        s.add(fb)
        s.commit()
    finally:
        with suppress(Exception):
            s.close()
    audit("feedback", user, detail=f"message_id={req.message_id} rating={req.rating}")

    try:
        from app.observability.metrics import USER_FEEDBACK_TOTAL
        label = "helpful" if req.rating > 0 else "not_helpful"
        USER_FEEDBACK_TOTAL.labels(rating=label).inc()
    except Exception as exc:
        logger.debug("Failed to record feedback metric: %s", exc)

    return {"status": "ok", "saved": True, "rating": req.rating}


@router.get("/api/escalations", response_model=EscalationsResponse)
def list_escalations(user: str = Depends(get_current_user)) -> dict:
    """Phase 6 — list the current user's escalation (Jira) tickets, newest first."""
    try:
        from app.persistence.database import SessionLocal
        from app.persistence.models import JiraTicket

        s = SessionLocal()
        rows = (s.query(JiraTicket)
                  .filter(JiraTicket.created_by == user)
                  .order_by(JiraTicket.created_at.desc())
                  .limit(50).all())
        _base = SETTINGS.jira_base_url.rstrip("/") if SETTINGS.jira_base_url else ""
        out = [{"id": t.id, "jira_key": t.jira_key, "domain": t.domain,
                "status": t.status, "created_at": t.created_at.isoformat(),
                "link": f"{_base}/browse/{t.jira_key}" if (_base and t.jira_key) else None,
                "session_id": str(t.session_id) if t.session_id else None}
               for t in rows]
        return {"escalations": out}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"escalations unavailable: {type(exc).__name__}")


@router.get("/api/contacts/{domain}")
def contacts(domain: str, user: str = Depends(get_current_user)) -> dict:
    return get_contact(domain)
