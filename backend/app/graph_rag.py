"""LangGraph RAG orchestration (v0.21.70 Phase 1 + v0.21.82 HITL rework).

Graph topology:

    classify → rewrite → retrieve → gate
                                  │
                        confidence low? ── yes ─→ rewrite (stronger) ─→ retrieve
                                  │
                                  no
                                  ↓
                               context → tools
                                              │
                    ticket intent, or caution + the
                    user's auto-escalate preference?
                                    │              │
                                   YES            NO
                                    ▼              ▼
                          ⏸ approval (interrupt)   END (answer)
                                    │
                     Command(resume={"approved": bool, "decided_by": str})
                                    │
                          approved? ─┬─ yes ─► create_ticket (real Jira API)
                                     │              │
                                     no             ▼
                                     ▼        answer_ticket (ticket_id in state)
                          END (rejected message)

HITL design (v0.21.82):
- The approval node uses langgraph.types.interrupt() so the graph pauses
  INSIDE the node; resuming with Command(resume={...}) delivers the admin
  decision (approved bool + decided_by) back into the graph as state.
- Ticket creation happens ONLY in the ticket node after approved=True —
  the API-side approval endpoint no longer creates tickets itself; it just
  resumes the graph with the decision. This keeps state transitions inside
  the graph (single source of truth) and lets the response node report the
  real Jira key.
- State carries approval_status + ticket_id + approval_note so any later
  node (and the UI) can show the final outcome.
"""
from __future__ import annotations

import logging
import re
from typing import Any, TypedDict

from app.config import SETTINGS

logger = logging.getLogger("langgraph_rag")

MAX_RETRIES = 0  # v0.22.2 — latency: single retrieve; no rewrite loop (35s -> ~12s)


class RAGState(TypedDict):
    # Retained for callers that still pass it; no longer used to pick a pipeline.
    # at all, this decides which of it. Declared here because LangGraph only carries keys
    # the state type declares.
    # Why the tool path ended the way it did: "ok" | "failed" | "error" |
    # "not_permitted". Surfaced to the UI so a tool failure is never mistaken for a
    # knowledge-base gap.
    tool_note: str | None
    # v1.6.65 — what was actually queried this turn: [{name, ms, bytes, server, at}].
    # The evidence panel renders this for a live answer (documents have sources).
    tool_calls: list | None
    # v1.6.68 — the verbatim tool output, shown only in the evidence card's
    # "Show full output" so the answer body does not repeat it.
    raw_output: str | None
    question: str
    history: list[dict] | None
    user: str | None
    top_k: int | None

    domain: str
    rewritten: str
    docs: list[dict]
    confidence: float
    decision: str
    retries: int
    context: str
    source: str  # "graph" for telemetry
    tool_used: str | None
    needs_approval: bool
    thread_id: str

    # v0.21.82 — HITL state
    approval_status: str           # "pending" | "approved" | "rejected"
    ticket_id: str | None
    escalation_messages: list[str]
    ticket_rows: list[dict]        # v0.21.90 — status-lookup rows for the UI


def _node_classify(state: RAGState) -> dict:
    from app.observability.telemetry import start_span

    # P3 — LLM classification first (accurate, handles Burmese and generic
    # questions); the keyword classifier remains the fallback so an LLM outage or
    # an air-gapped deployment degrades instead of failing.
    from app.classifier.llm_classifier import classify_domain_smart

    with start_span("graph.classify_domain", {"question": state["question"][:60]}):
        domain, _conf, reason = classify_domain_smart(state["question"])
    # NB: only declared RAGState keys may be returned to LangGraph, so the reason is
    # logged rather than added to the state (an undeclared key is dropped and would
    # silently make the trace lie).
    logger.debug("classified %r -> %s (%s)", state["question"][:40], domain, reason)
    return {"domain": domain}


def _node_rewrite(state: RAGState) -> dict:
    from app.observability.telemetry import start_span
    from app.orchestration.orchestrator import _query_rewrite

    q = state["rewritten"] or state["question"]
    with start_span("graph.query_rewrite"):
        return {"rewritten": _query_rewrite(q, state["history"])}


def _node_retrieve(state: RAGState) -> dict:
    from app.observability.telemetry import start_span
    from app.orchestration.orchestrator import _retrieve

    with start_span("graph.hybrid_retrieve", {"domain": state["domain"]}):
        docs = _retrieve(state["rewritten"], state["domain"], k=state["top_k"])
    return {"docs": docs}


def _node_gate(state: RAGState) -> dict:
    from app.observability.telemetry import start_span
    from app.orchestration.orchestrator import _gate

    with start_span("graph.confidence_gate"):
        confidence, decision = _gate(state["docs"])
    return {"confidence": confidence, "decision": decision,
            "retries": state["retries"] + 1}


def _node_tools(state: RAGState) -> dict:
    """Ticket tool decision (v0.21.90).

    Two intents are handled differently:
    - STATUS lookup ("status of my tickets", "ITHD-5") → answer from the live
      ticket DB with high confidence. Never interrupts.
    - CREATE ("create a ticket for X") → needs admin approval only when the KB
      retrieval confidence is weak.
    The old single-intent check let "what is the status of my ticket" fall into
    the approval interrupt path — that conflict is what this split fixes."""
    from app.rag.gate import DECISION_CAUTION
    from app.tools.ticket_tool import (
        detect_ticket_create_intent,
        detect_ticket_status_intent,
        fetch_ticket_context,
    )

    user = state.get("user")
    out: dict = {"tool_used": None, "needs_approval": False}
    if not user:
        return out

    q = state["question"]

    if detect_ticket_status_intent(q):
        ctx, rows = fetch_ticket_context(user, q)
        if ctx:
            out.update(
                tool_used="tickets",
                ticket_rows=rows,
                context=(ctx + "\n\n" + (state.get("context") or "")).strip(),
                confidence=0.95,
                decision="answer",
            )
        return out

    intent = detect_ticket_create_intent(q)
    out["tool_used"] = "tickets" if intent else None
    # v0.21.95 — create-ticket intent ALWAYS requires admin approval (HITL design:
    # "Call Tool node only after approval"). The old `intent and weak` condition let a
    # confident KB answer silently swallow the escalation.
    out["needs_approval"] = bool(intent)

    # v0.21.96 — `auto_escalate_on_caution` finally does something.
    #
    # It was stored on `user_settings`, served by /api/settings and typed in the
    # frontend, and read by NO logic — so a below-threshold answer showed the caution
    # banner and stopped there, and the human the setting promises never saw it. The
    # gate already reached its verdict upstream in `_node_gate`; use that verdict as
    # the trigger instead of inventing a second confidence test here.
    #
    # It is a PER-USER preference, not a runtime KV: read the user's own row, so a
    # toggle in Settings takes effect on their next question. Off by default, and off
    # for an anonymous turn — nobody is escalated on behalf of a user who never asked.
    if not intent and state.get("decision") == DECISION_CAUTION and _auto_escalate(user):
        out["needs_approval"] = True
        out["tool_used"] = "escalation"
        logger.info("auto-escalating a caution answer for %r (confidence=%s)",
                    q[:40], state.get("confidence"))
    return out


def _auto_escalate(username: str | None) -> bool:
    """The caller's `auto_escalate_on_caution` preference. Default False.

    Read at request time from the user's own `user_settings` row, so toggling it in
    Settings applies to the next question with no restart. No row (the user has never
    opened Settings) and no username both mean False: escalation is a side effect with
    a real-world cost — a Jira ticket and an admin's attention — so it must never fire
    for someone who did not ask for it.
    """
    if not username:
        return False
    from app.persistence.database import SessionLocal
    from app.persistence.models import UserSettings

    s = SessionLocal()
    try:
        row = s.get(UserSettings, username)
        return bool(row.auto_escalate_on_caution) if row else False
    except Exception as exc:  # noqa: BLE001 — a preference lookup must not break the turn
        logger.warning("auto_escalate_on_caution lookup failed for %r: %s", username, exc)
        return False
    finally:
        s.close()


def _node_approval(state: RAGState) -> dict:
    """Human-in-the-loop gate.

    Pauses the graph at this node via interrupt(). The admin's decision is
    delivered on resume as Command(resume={"approved": bool, "decided_by": ...}).
    """
    from langgraph.types import interrupt

    # First execution: pauses here and surfaces the payload to the operator.
    # `reason` distinguishes the two ways a turn reaches this node, because they need
    # different decisions from the admin: a user ASKED for a ticket, versus the gate
    # was not confident and the user's `auto_escalate_on_caution` raised it.
    decision = interrupt({
        "question": "Escalation approval requested",
        "details": state["question"],
        "user": state.get("user"),
        "confidence": state["confidence"],
        "reason": ("auto_caution" if state.get("tool_used") == "escalation"
                   else "ticket_request"),
    })
    # Resumed: `decision` is the Command(resume=...) payload.
    approved = bool(decision.get("approved", False))
    logger.info("approval resumed: approved=%s by=%s",
                approved, decision.get("decided_by"))
    return {
        "approval_status": "approved" if approved else "rejected",
        "decision": "answer" if approved else "rejected",
    }


def _node_create_ticket(state: RAGState) -> dict:
    """Runs ONLY after approval. Creates the real Jira ticket and stores its id."""
    if state.get("approval_status") != "approved":
        return {"escalation_messages": ["❌ Ticket creation was rejected by the administrator."],
                "ticket_id": None}

    from app.integrations.jira import escalate as jira_escalate
    from app.persistence.database import SessionLocal
    from app.persistence.models import JiraTicket

    summary = (state["question"] or "Escalation")[:120]
    jr = jira_escalate(summary=summary, description=state["question"] or "",
                       reporter=state.get("user") or None, domain="general")
    ticket_id = jr.get("jira_key") or None

    # v1.6.4 — external-only policy: without a real Jira key nothing is saved;
    # the user sees why instead of a phantom local-only ticket.
    if not ticket_id:
        reason = jr.get("error") or "Jira did not return a ticket key"
        return {"escalation_messages": [
            f"❌ Ticket was NOT created in Jira ({reason}). Nothing was saved — "
            "fix Jira in Settings → Integrations and retry."],
            "ticket_id": None}

    with SessionLocal() as s:
        s.add(JiraTicket(jira_key=ticket_id, subject=summary,
                         description=state["question"] or "",
                         created_by=state.get("user"), status="Open"))
        s.commit()
    try:
        from app.notifier import notify_ticket_created
        notify_ticket_created(state.get("user"), ticket_id, summary)
    except Exception:  # noqa: BLE001
        pass

    link = jr.get("link") or ""
    msg = (f"✅ Ticket ({ticket_id or 'created'}) opened successfully. "
           f"The IT team will follow up shortly." + (f" Track: {link}" if link else ""))
    logger.info("ticket created from approval: %s", ticket_id)
    return {"ticket_id": ticket_id,
            "escalation_messages": [msg]}


def _route_after_approval(state: RAGState) -> str:
    return "create_ticket" if state.get("approval_status") == "approved" else "rejected"


def _node_rejected(state: RAGState) -> dict:
    return {"escalation_messages": ["❌ Ticket creation was rejected by the administrator."],
            "ticket_id": None}


def _node_context(state: RAGState) -> dict:
    from app.orchestration.orchestrator import _context

    return {"context": _context(state["docs"], state["rewritten"])}


def _route_after_tools(state: RAGState) -> str:
    return "escalate" if state.get("needs_approval") else "answer"


def _route_after_gate(state: RAGState) -> str:
    """Confidence below threshold + retries left → rewrite again; else answer."""
    threshold = getattr(SETTINGS, "confidence_gate_threshold", 0.75)
    if state["confidence"] < threshold and state["retries"] <= MAX_RETRIES:
        return "rewrite"
    return "context"


def _checkpointer():
    """Durable cross-pod checkpointer (v0.21.82).

    MemorySaver is per-process — with HPA replicas the approve request can hit a
    different pod than the one that paused the graph, and the checkpoint is lost.
    Postgres saver stores checkpoints in the assistant DB so any replica can resume.
    """
    import os

    from langgraph.checkpoint.postgres import PostgresSaver

    import psycopg
    from langgraph.checkpoint.postgres import PostgresSaver

    url = os.environ.get("DATABASE_URL", "")
    # Normalize any SQLAlchemy driver scheme to plain psycopg3 conninfo
    url = re.sub(r"^postgresql\+\w+://", "postgresql://", url)
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    # Hold one persistent connection per process. autocommit is required by the
    # checkpoint saver; keepalives survive CNPG/pod idle reaping.
    conn = psycopg.connect(
        url,
        autocommit=True,
        connect_timeout=10,
        keepalives=1,
        keepalives_idle=30,
        application_name="langgraph-checkpoint",
    )
    return PostgresSaver(conn)


def build_rag_graph():
    """Compile the RAG graph (imported lazily so the API boots without langgraph)."""
    from langgraph.graph import END, StateGraph

    g = StateGraph(RAGState)
    g.add_node("classify", _node_classify)
    g.add_node("rewrite", _node_rewrite)
    g.add_node("retrieve", _node_retrieve)
    g.add_node("gate", _node_gate)
    g.add_node("context", _node_context)
    g.add_node("tools", _node_tools)
    g.add_node("approval", _node_approval)
    g.add_node("create_ticket", _node_create_ticket)
    g.add_node("rejected", _node_rejected)

    g.set_entry_point("classify")
    g.add_edge("classify", "rewrite")
    g.add_edge("rewrite", "retrieve")
    g.add_edge("retrieve", "gate")
    g.add_conditional_edges("gate", _route_after_gate,
                            {"rewrite": "rewrite", "context": "context"})
    g.add_edge("context", "tools")
    g.add_conditional_edges("tools", _route_after_tools,
                            {"escalate": "approval", "answer": END})
    g.add_conditional_edges("approval", _route_after_approval,
                            {"ticket": "create_ticket", "rejected": "rejected"})
    g.add_edge("create_ticket", END)
    g.add_edge("rejected", END)
    cp = None
    last_exc = None
    for attempt in range(2):
        try:
            cp = _checkpointer()
            cp.setup()
            logger.info("using Postgres checkpointer (durable, cross-pod)")
            break
        except Exception as exc:
            last_exc = exc
            logger.warning("Postgres checkpointer attempt %s failed: %s", attempt + 1, exc)
    if cp is None:
        logger.error("HITL degraded to in-memory checkpoints (last error: %s)", last_exc)
        from langgraph.checkpoint.memory import MemorySaver

        cp = MemorySaver()
    return g.compile(checkpointer=cp)


_GRAPH = None  # compiled once (with checkpointer) per process


def get_graph():
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = build_rag_graph()
    return _GRAPH


def run_rag_graph(query: str, history: list[dict] | None = None,
                  top_k: int | None = None, user: str | None = None,
                  thread_id: str | None = None,
                  resume_command: dict | None = None) -> dict:
    """Execute (or resume) the graph. Returns state + whether approval is pending.

    resume_command: {"approved": bool, "decided_by": str} — delivered into the
    approval node via Command(resume=...) as the interrupt() return value.
    """
    from langgraph.types import Command

    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id or user or "default"}}

    if resume_command is not None:
        # If the checkpoint for this thread is absent or has no pending interrupt in
        # THIS process (another replica paused it), resuming would re-run from START
        # with an empty state. Detect that and apply the decision directly instead.
        snap = graph.get_state(config)
        if snap is None or not snap.next or snap.next != ("approval",):
            logger.warning(
                "no pending interrupt for thread %s in this replica (next=%s) — "
                "applying decision directly", thread_id, getattr(snap, "next", None))
            approved = bool(resume_command.get("approved"))
            fake: RAGState = {
                "question": query, "history": None, "user": user, "top_k": top_k,
                "domain": "general", "rewritten": query, "docs": [], "confidence": 0.0,
                "decision": "answer", "retries": 0, "context": "", "source": "graph",
                "tool_used": "tickets", "needs_approval": False,
                "thread_id": thread_id or user or "default",
                "approval_status": "approved" if approved else "rejected",
                "ticket_id": None, "escalation_messages": [],
            }
            if approved:
                upd = _node_create_ticket(fake)
            else:
                upd = _node_rejected(fake)
            out = {**fake, **upd, "pending_approval": False}
            return out
        # Normal path: deliver the admin decision into the interrupt() call.
        final: RAGState = graph.invoke(
            Command(resume=resume_command), config=config)
    else:
        final: RAGState = graph.invoke({
            "question": query, "history": history, "user": user, "top_k": top_k,
            "domain": "", "rewritten": "", "docs": [], "confidence": 0.0,
            "decision": "caution", "retries": 0, "context": "", "source": "graph",
            "tool_used": None, "needs_approval": False,
            "thread_id": thread_id or user or "default",
            "approval_status": "pending", "ticket_id": None,
            "escalation_messages": [],
        }, config=config)

    pending = graph.get_state(config).next == ("approval",)
    logger.info("langgraph run: retries=%s confidence=%.2f docs=%s pending_approval=%s "
                "approval_status=%s ticket_id=%s",
                final["retries"], final["confidence"], len(final["docs"]),
                pending, final.get("approval_status"), final.get("ticket_id"))
    return {**dict(final), "pending_approval": pending}


STAGE_LABELS = {
    "classify": "Understanding your question",
    "rewrite": "Refining the search query",
    "retrieve": "Searching the knowledge base",
    "gate": "Scoring answer confidence",
    "context": "Preparing context for the answer",
    "tools": "Checking tickets & escalation",
    "approval": "Waiting for administrator approval",
    "create_ticket": "Creating the ticket",
    "rejected": "Finalizing",
}


def run_rag_graph_stream(query: str, history: list[dict] | None = None,
                         top_k: int | None = None, user: str | None = None,
                         thread_id: str | None = None):
    """Generator version: yields (stage_label) as each node completes, then the
    final dict at the end (same shape as run_rag_graph). Powers SSE progress
    feedback so the UI can show what the pipeline is doing (v0.21.90)."""
    graph = get_graph()
    config = {"configurable": {"thread_id": thread_id or user or "default"}}
    payload = {
        "question": query, "history": history, "user": user, "top_k": top_k,
        "domain": "", "rewritten": "", "docs": [], "confidence": 0.0,
        "decision": "caution", "retries": 0, "context": "", "source": "graph",
        "tool_used": None, "needs_approval": False,
        "tool_note": None,
        "thread_id": thread_id or user or "default",
        "approval_status": "pending", "ticket_id": None,
        "escalation_messages": [], "ticket_rows": [],
    }
    final: dict = {}
    for chunk in graph.stream(payload, config=config, stream_mode="updates"):
        # chunk: {node_name: updates} — but the terminal __FINAL__ sentinel is a
        # plain tuple, not a node-update mapping; skip it here (handled below).
        if not isinstance(chunk, dict):
            continue
        for node in chunk:
            label = STAGE_LABELS.get(node)
            if label:
                # v1.6.16 — yield (node_name, label) so chat.py can send an exact
                # canonical stage key; detail text alone is ambiguous for timing.
                yield (node, label)
        # accumulate last state — values may be tuples (e.g. __interrupt__), skip those
        for n in chunk:
            upd = chunk[n]
            if isinstance(upd, dict):
                final.update(upd)
    state = graph.get_state(config)
    values = dict(state.values or {})
    merged = {**final, **values}
    pending = state.next == ("approval",)
    logger.info("langgraph stream run: retries=%s confidence=%.2f pending=%s",
                merged.get("retries"), merged.get("confidence"), pending)
    yield ("__FINAL__", {**merged, "pending_approval": pending})
