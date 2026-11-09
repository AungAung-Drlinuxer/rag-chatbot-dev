/**
 * Chat — the support workspace.
 *
 * Every pixel of data here is real: answers arrive over `/api/chat/stream` (meta → stage →
 * token → done), conversations are loaded from the conversations API, sources are the
 * `meta.hits` the retriever actually returned, and the health strip is the same
 * `/api/dashboard/health` probe the Overview uses. Nothing is pre-filled: a new chat is
 * empty and says so, and an answer with no sources shows no source list.
 *
 * Layout is a three-part column that owns its own scrolling:
 *   header (fixed) · transcript (scrolls) · composer (fixed)
 * with the evidence rail only from `xl`, because on a phone the transcript is the product.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  CornerDownLeft,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Ticket,
  X,
} from "lucide-react";

import MessageBubble from "@/features/chat/components/MessageBubble";
import SystemStatus from "@/features/chat/components/SystemStatusPanel";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { submitFeedback } from "@/features/chat/api";
import { getConversationMessages } from "@/features/conversations/api";
import { EscalateDialog } from "@/features/escalation/EscalateDialog";
import { CreateTicketDialog } from "@/features/tickets/components/CreateTicketDialog";
import { formatMessageTime, latestSources, type Message, type Source } from "@/features/chat/model";
import { toSources } from "@/features/chat/sources";
import {
} from "@/components/ui/dialog";

type Props = {
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onNavigate?: (nav: string) => void;
  onLogout?: () => void;
};

/* ---------------------------------------------------------------- greeting */

function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** "ith@dmin" → "Ith"; "alice.anderson" → "Alice"; falls back to a neutral salutation. */
function displayName(raw?: string): string {
  const base = (raw ?? "").split("@")[0].split(/[._-]/)[0].trim();
  if (!base) return "there";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function Greeting({ name, composer }: { name: string; composer: React.ReactNode }) {
  return (
    <section className="w-full text-center">
      <span className="mx-auto mb-6 grid size-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-foreground)] ring-1 ring-[var(--border)]">
        <Sparkles className="size-[18px]" aria-hidden />
      </span>

      <h1 className="text-[30px] font-semibold leading-tight tracking-tight sm:text-[38px]">
        {greetingFor()}, {name}
      </h1>
      <p className="mx-auto mt-2.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Ask an IT question. Get a clear answer grounded in your organization&rsquo;s knowledge base.
      </p>

      {/* One composer, placed where the first question is typed; it docks to the bottom
          once there is a transcript to put above it. */}
      <div className="mx-auto mt-8 w-full max-w-2xl text-left">{composer}</div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck className="size-3" aria-hidden />
        Answers cite the pages they used — check anything destructive before acting on it.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- page */

export default function Chat({ onNavigate, userName }: Props) {
  const [sessionId, setSessionId] = useState<string>(() => crypto.randomUUID());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [stage, setStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 1 | -1>>({});
  const [toast, setToast] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  // The chat does not own a ticket form: it opens the same dialog the Tickets page uses,
  // with the question and the answer as its starting text.
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [ticketFor, setTicketFor] = useState<Message | null>(null);
  const [ticketPreset, setTicketPreset] = useState<{ subject: string; description: string }>({ subject: "", description: "" });

  const history = useRef<{ role: string; content: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startedAt = useRef(0);

  const isStreaming = streamingId !== null;

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const scrollToEnd = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Auto-grow the composer up to 8 lines, then it scrolls.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [input]);

  useEffect(() => {
    if (!isStreaming) return;
    const t = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 250);
    return () => window.clearInterval(t);
  }, [isStreaming]);

  useEffect(() => {
    scrollToEnd(false);
  }, [messages.length, scrollToEnd]);

  /* ---------------- conversations ---------------- */

  const openConversation = useCallback(async (id: string) => {
    setSessionId(id);
    setLoadingConversation(true);
    setMessages([]);
    try {
      const res: any = await getConversationMessages(id);
      const loaded: Message[] = (res?.messages ?? []).map((m: any, i: number) => ({
        id: m.message_id || `m-${i}`,
        role: m.role,
        content: m.content ?? "",
        timestamp: formatMessageTime(m.timestamp ?? m.created_at),
        confidence: m.meta?.confidence != null ? Math.round(m.meta.confidence * 100) : undefined,
        decision: m.meta?.decision,
        sources: toSources(m.meta?.hits),
        usage: m.meta?.usage,
        retrieval: m.meta?.retrieval,
        toolUsed: m.meta?.tool_used,
        // The feedback target is the top-level message_id from the API; reading only
        // meta.server_id left every re-opened answer without a feedback target.
        serverId: m.message_id || m.meta?.server_id,
        guardrailType: m.meta?.guardrail,
      }));
      setMessages(loaded);
      history.current = loaded.map((m) => ({ role: m.role, content: m.content }));
      window.setTimeout(() => scrollToEnd(false), 80);
    } catch {
      notify("Could not load this conversation.");
    } finally {
      setLoadingConversation(false);
    }
  }, [notify, scrollToEnd]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(crypto.randomUUID());
    setMessages([]);
    setStreamingId(null);
    setStage("");
    setInput("");
    history.current = [];
    window.setTimeout(() => composerRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    const onOpen = (e: any) => { if (e?.detail) void openConversation(e.detail); };
    const onNew = () => startNewChat();
    const onAsk = (e: any) => {
      if (typeof e?.detail === "string" && e.detail) {
        setInput(e.detail);
        window.setTimeout(() => composerRef.current?.focus(), 30);
      }
    };
    window.addEventListener("ith:open-conversation", onOpen);
    window.addEventListener("ith:new-chat", onNew);
    window.addEventListener("ith:ask", onAsk);
    return () => {
      window.removeEventListener("ith:open-conversation", onOpen);
      window.removeEventListener("ith:new-chat", onNew);
      window.removeEventListener("ith:ask", onAsk);
    };
  }, [openConversation, startNewChat]);

  /* ---------------- send / stream ---------------- */

  const send = useCallback(async (direct?: string, opts?: { replaceId?: string }) => {
    const question = (direct ?? input).trim();
    if (!question || streamingId) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: formatMessageTime(new Date().toISOString()),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: formatMessageTime(new Date().toISOString()),
    };

    /* `replaceId` is the edit / retry path: the original question stays where it is
       (same bubble, new text) and everything after it is dropped, because those answers
       answered a question the user has just replaced. Appending instead left the old
       answer sitting above the new one — two contradictory replies to "the same" turn. */
    setMessages((prev) => {
      if (opts?.replaceId) {
        const i = prev.findIndex((m) => m.id === opts.replaceId);
        if (i >= 0) {
          return [
            ...prev.slice(0, i),
            { ...prev[i], content: question, timestamp: formatMessageTime(new Date().toISOString()), feedback: undefined },
            assistantMsg,
          ];
        }
      }
      return [...prev, userMsg, assistantMsg];
    });
    if (opts?.replaceId) {
      const i = messages.findIndex((m) => m.id === opts.replaceId);
      const head = i >= 0 ? messages.slice(0, i) : [];
      history.current = [...head.map((m) => ({ role: m.role, content: m.content })),
                        { role: "user", content: question }];
    } else {
      history.current = [...history.current, { role: "user", content: question }];
    }
    setInput("");
    setStage("Understanding the question");
    setElapsed(0);
    startedAt.current = Date.now();
    setStreamingId(assistantId);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      await runChatStream(
        question,
        sessionId,
        history.current.slice(0, -1),
        {
          onMeta: (meta: any) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                      decision: meta.decision,
                      sources: toSources(meta.hits),
                      usage: meta.usage,
                      retrieval: meta.retrieval,
                      toolUsed: meta.tool_used,
                      // The refusal is stored as a normal answer; this tells the card to
                      // explain WHY it is one (and which rule fired).
                      guardrailType: meta.guardrail?.type,
                    }
                  : m,
              ),
            );
          },
          onToken: (token: string) => {
            setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + token } : m)));
          },
          onStage: (detail: string) => setStage(detail),
          onApprovalRequest: () => setStage("Waiting for an approval decision"),
          onCaution: () => setStage("Low confidence — showing a caution notice"),
          onDone: (d: any) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      latencyMs: d?.latency_ms ?? Date.now() - startedAt.current,
                      ragTrace: d?.rag_trace ?? m.ragTrace,
                      serverId: d?.message_id ?? m.serverId,
                    }
                  : m,
              ),
            );
            setStreamingId(null);
            setStage("");
            window.dispatchEvent(new CustomEvent("ith:refresh-conversations"));
          },
        },
        "auto",
        ctrl.signal,
      );
    } catch (err: any) {
      const aborted = err?.name === "AbortError";
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          if (aborted) return { ...m, content: m.content };
          return {
            ...m,
            content: m.content || `The answer could not be generated: ${err?.message ?? "connection error"}.`,
            decision: "error",
          };
        }),
      );
      if (!aborted) notify("The answer stream failed.");
    } finally {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantId) return m;
          history.current.push({ role: "assistant", content: m.content });
          return m;
        }),
      );
      setStreamingId(null);
      setStage("");
      abortRef.current = null;
    }
  }, [input, messages, notify, sessionId, streamingId]);

  const stop = () => {
    abortRef.current?.abort();
    setStreamingId(null);
    setStage("");
    notify("Generation stopped.");
  };

  const rate = async (m: Message, rating: 1 | -1) => {
    try {
      await submitFeedback(m.serverId ?? m.id, rating);
      setFeedback((prev) => ({ ...prev, [m.id]: rating }));
      notify(rating === 1 ? "Thanks — marked helpful." : "Noted — we will review this answer.");
    } catch {
      notify("Feedback could not be saved.");
    }
  };

  const latest = useMemo<Source[]>(() => latestSources(messages), [messages]);
  const lastAnswer = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant" && m.content), [messages]);

  function openTicket(m: Message) {
    const question = [...messages].slice(0, messages.indexOf(m)).reverse().find((x) => x.role === "user");
    setTicketPreset({
      subject: question?.content.slice(0, 90) || "Incident from the IT assistant",
      description: m.content,
    });
    setTicketFor(m);
  }

  const citedTitles = useMemo(() => new Set(latest.map((s) => s.title)).size, [latest]);
  const answered = useMemo(() => messages.filter((m) => m.role === "assistant" && m.content).length, [messages]);

  const rail = (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-card p-3">
        <h2 className="text-xs font-semibold">This conversation</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Answers</dt>
            <dd className="font-medium tabular-nums">{answered}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Pages cited</dt>
            <dd className="font-medium tabular-nums">{citedTitles}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Passages</dt>
            <dd className="font-medium tabular-nums">{latest.length}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">Last</dt>
            <dd className="font-medium tabular-nums">
              {lastAnswer?.latencyMs ? `${(lastAnswer.latencyMs / 1000).toFixed(1)}s` : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-2xs leading-4 text-muted-foreground">
          Every answer lists the pages it used underneath it.
        </p>
      </section>

      {lastAnswer?.retrieval && ((lastAnswer.retrieval.chunks ?? 0) > 0 || (lastAnswer.retrieval.cited ?? 0) > 0) && (
        <section className="rounded-xl border border-[var(--border)] bg-card p-3">
          <h2 className="text-xs font-semibold">Last retrieval</h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-2xs">
            {[
              ["Chunks", lastAnswer.retrieval.chunks],
              ["Cited", lastAnswer.retrieval.cited],
              ["Top-k", lastAnswer.retrieval.top_k],
              ["Reranked", lastAnswer.retrieval.rerank_used == null ? undefined : lastAnswer.retrieval.rerank_used ? "Yes" : "No"],
              ["ACL scoped", lastAnswer.retrieval.acl_scoped == null ? undefined : lastAnswer.retrieval.acl_scoped ? "Yes" : "No"],
              ["Role", lastAnswer.retrieval.role],
            ]
              .filter(([, v]) => v !== undefined && v !== null && v !== "")
              .map(([k, v]) => (
                <div key={String(k)} className="flex items-baseline justify-between gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-medium tabular-nums">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </section>
      )}

      <SystemStatus onNavigate={onNavigate} />
    </div>
  );

  // One composer, two positions: centred in the hero before the first question, docked at
  // the bottom once there is a transcript. `#chat-input` is the same node either way, so the
  // keyboard shortcut, the auto-grow and the tests all keep working across the switch.
  const composerForm = (hero: boolean) => (
    <form
      onSubmit={(e) => { e.preventDefault(); void send(); }}
      className={[
        "mx-auto w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-card transition",
        "focus-within:border-[var(--primary)]/60 focus-within:ring-4 focus-within:ring-[var(--primary)]/10",
        hero ? "p-2.5 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)]" : "p-2 shadow-sm",
      ].join(" ")}
    >
      <label htmlFor="chat-input" className="sr-only">Ask a question</label>
      <textarea
        id="chat-input"
        ref={composerRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={1}
        placeholder={hero ? "Ask anything about IT — incidents, procedures, access…" : "Ask about an incident, a procedure or a system…"}
        className="max-h-44 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none placeholder:text-muted-foreground"
      />

      <div className="flex items-center justify-between gap-2 px-1 pt-1">
        <span className="hidden items-center gap-1.5 text-2xs text-muted-foreground sm:inline-flex">
          <CornerDownLeft className="size-3" aria-hidden /> Enter to send · Shift+Enter for a new line
        </span>
        <span className="text-2xs text-muted-foreground sm:hidden">
          {input.length > 0 ? `${input.length} characters` : "Grounded in your KB"}
        </span>

        <div className="flex items-center gap-1.5">
          {input.length > 3200 && (
            <span className="text-2xs tabular-nums text-[var(--warn)]">{input.length}/4000</span>
          )}
          {isStreaming ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--border)] bg-card px-3 text-xs font-semibold transition hover:bg-muted"
            >
              <Square className="size-3.5" aria-hidden /> Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className={[
                "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40",
                hero ? "size-9 justify-center" : "h-9 px-3.5 text-xs",
              ].join(" ")}
            >
              <Send className="size-3.5" aria-hidden />
              {!hero && "Send"}
            </button>
          )}
        </div>
      </div>
    </form>
  );

  const empty = messages.length === 0 && !isStreaming && !loadingConversation;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {empty ? (
            /* ---------------- hero: centred greeting + composer ---------------- */
            <div className="relative min-h-0 flex-1 overflow-y-auto">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,var(--accent-soft),transparent)]"
              />
              <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-12 sm:px-6">
                <Greeting
                  name={displayName(userName)}
                  composer={composerForm(true)}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="relative min-h-0 flex-1">
                <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5 xl:right-4">
                  {isStreaming && (
                    <span className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-card px-2 py-1 text-2xs font-medium text-muted-foreground shadow-sm">
                      <Loader2 className="size-3 animate-spin" aria-hidden /> Answering
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setEscalateOpen(true)}
                    title="Escalate to IT — draft a ticket from this conversation"
                    aria-label="Escalate to IT"
                    className="pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-2xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 active:scale-[0.98]"
                  >
                    <Ticket className="size-3.5" aria-hidden /> Escalate to IT
                  </button>
                  <button
                    type="button"
                    onClick={() => setRailOpen(true)}
                    title="Conversation details"
                    aria-label="Conversation details"
                    className="pointer-events-auto grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card text-muted-foreground shadow-sm transition hover:text-foreground xl:hidden"
                  >
                    <BookOpen className="size-4" aria-hidden />
                  </button>
                </div>

                <div ref={scrollRef} className="h-full min-h-0 overflow-y-auto px-4 sm:px-6" aria-live="polite">
                  <div className="mx-auto w-full max-w-3xl space-y-5 py-6 sm:py-8">
                    {loadingConversation && (
                      <div className="space-y-3">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
                        ))}
                      </div>
                    )}

                    {!loadingConversation &&
                      messages.map((m) => {
                        const busy = streamingId === m.id;
                        return (
                          <div key={m.id} data-role={m.role}>
                            <MessageBubble
                              message={m}
                              onHelpful={() => void rate(m, 1)}
                              onNotHelpful={() => void rate(m, -1)}
                              onOpenTicketForm={() => openTicket(m)}
                              /* Edit: resend the edited text in place of the original turn.
                                 This prop was never passed before, so "Save & resend"
                                 closed the editor and did nothing. */
                              onSubmitEdit={(id, text) => void send(text, { replaceId: id })}
                              /* Retry: re-run THIS question. It used to search backwards
                                 for the previous user turn, so it re-asked the message
                                 before the one you clicked. */
                              onRetryQuestion={() => void send(m.content, { replaceId: m.id })}
                              busy={busy}
                              liveStageText={busy ? stage : undefined}
                              liveElapsedMs={busy ? elapsed : undefined}
                            />

                            {feedback[m.id] === 1 && <span className="sr-only">Marked helpful</span>}
                          </div>
                        );
                      })}

                    <div className="h-2" />
                  </div>
                </div>
              </div>

              {/* ---------------- docked composer ---------------- */}
              <div className="shrink-0 bg-gradient-to-t from-background via-background to-background/0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
                {composerForm(false)}
                <p className="mx-auto mt-1.5 max-w-3xl text-center text-[10px] text-muted-foreground">
                  Answers cite the pages they used. Check anything destructive before acting on it.
                </p>
              </div>
            </>
          )}
        </div>

        {/* ---------------- evidence rail (xl) ---------------- */}
        {!empty && (
          <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-[var(--border)] px-3 py-4 xl:block">
            <div className="sticky top-0">{rail}</div>
          </aside>
        )}
      </div>

      {/* ---------------- mobile rail ---------------- */}
      {railOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 xl:hidden"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setRailOpen(false); }}
        >
          <div role="dialog" aria-modal="true" aria-label="Conversation details" className="flex h-full w-full max-w-sm flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold">Conversation details</h2>
              <button type="button" aria-label="Close details" onClick={() => setRailOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{rail}</div>
          </div>
        </div>
      )}

      {/* ---------------- escalate ---------------- */}
      {/* Same form as Tickets → Create ticket: one dialog, one set of fields. */}
      <EscalateDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        sessionId={sessionId}
        onToast={notify}
      />

      <CreateTicketDialog
        open={!!ticketFor}
        onOpenChange={(o) => { if (!o) setTicketFor(null); }}
        preset={{
          subject: ticketPreset.subject,
          description: ticketPreset.description,
          sessionId,
        }}
        onToast={notify}
      />

      {toast && (
        <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-foreground px-3.5 py-2 text-2xs font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
