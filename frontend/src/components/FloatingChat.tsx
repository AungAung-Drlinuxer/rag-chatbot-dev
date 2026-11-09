/**
 * Global floating chat popup — MASTER spec §24-quality mini assistant.
 *
 * Opened from the NeedHelpCard ("Open Chat"). State lives in App-level
 * context/mount so the popup + conversation persist across page switches.
 *
 * v0.22 additions (user feedback):
 *  - Connection errors: auto-retry (2x) + manual "Retry" button on failed bubble
 *  - Message actions: copy answer / copy question / edit & resend user query
 *  - Minimize button: collapses to a round bubble; reopen restores conversation
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AgentActivity, { stageFromText } from "@/components/AgentActivity";
import Composer from "@/components/Composer";
import MarkdownMessage from "@/components/MarkdownMessage";
import {
  Bot,
  Check,
  Copy,
  Minus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share2,
  Shield,
  Sparkles,
  X,
} from "lucide-react";
import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { currentTime, type Message, type Source } from "@/features/chat/model";
import { uploadAttachment } from "@/features/chat/api";
import { useUserPreferences } from "@/app/useUserPreferences";

/* ---------------- Context ---------------- */

type FloatingChatCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  minimized: boolean;
  setMinimized: (v: boolean) => void;
};

const Ctx = createContext<FloatingChatCtx>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  minimized: false,
  setMinimized: () => {},
});

export function useFloatingChat() {
  return useContext(Ctx);
}

export function FloatingChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  return (
    <Ctx.Provider value={{ open, setOpen, toggle, minimized, setMinimized }}>
      {children}
    </Ctx.Provider>
  );
}

/* ---------------- Helpers ---------------- */

function CopyButton({ getText, label }: { getText: () => string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
        } catch {
          // clipboard API unavailable (http) — fallback
          const ta = document.createElement("textarea");
          ta.value = getText();
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
    >
      {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
    </button>
  );
}

type Msg = Message & { sources?: Source[]; confidence?: number; failed?: boolean; retryQuestion?: string };

export function FloatingChatPopup() {
  const preferences = useUserPreferences();
  const { open, setOpen, minimized, setMinimized } = useFloatingChat();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [stage, setStage] = useState<string | undefined>();
  // v1.6.38 — elapsed ms for the animated activity indicator
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sessionRef] = useState(() => crypto.randomUUID());
  const [editingId, setEditingId] = useState<string | null>(null);
  // v1.6.45 — brief confirmation for copy/share actions
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }, []);
  const [editText, setEditText] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping, minimized]);

  // tick a local clock while the agent is working
  useEffect(() => {
    if (!isTyping) {
      setElapsedMs(0);
      return;
    }
    const startedAt = performance.now();
    const id = setInterval(() => setElapsedMs(Math.round(performance.now() - startedAt)), 200);
    return () => clearInterval(id);
  }, [isTyping]);

  useEffect(() => {
    if (editingId) editRef.current?.focus();
  }, [editingId]);

  /* Core stream runner — used by send() and retry(). failed bubbles carry
     the originating question in `retryQuestion`. */
  const runQuestion = useCallback(
    (question: string, opts?: { replaceBotId?: string; attempt?: number }) => {
      const attempt = opts?.attempt ?? 0;
      const botId = opts?.replaceBotId ?? `b-${Date.now()}`;
      if (!opts?.replaceBotId) {
        setMessages((p) => [
          ...p,
          { id: `u-${Date.now()}`, role: "user", content: question, timestamp: currentTime() },
          { id: botId, role: "assistant", content: "", timestamp: currentTime() },
        ]);
      } else {
        // reset the failed bubble for retry
        setMessages((p) =>
          p.map((m) => (m.id === botId ? { ...m, content: "", failed: false } : m)),
        );
      }
      setIsTyping(true);

      const history = messages
        .filter((m) => !m.failed)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      runChatStream(question, sessionRef, history, {
        onMeta: () => {},
        onStage: (d) => setStage(d),
        onToken: (tok) =>
          setMessages((p) => p.map((m) => (m.id === botId ? { ...m, content: m.content + tok } : m))),
        onApprovalRequest: () => {},
        onDone: (d) => {
          const meta = d ?? {};
          setMessages((p) =>
            p.map((m) =>
              m.id === botId
                ? {
                    ...m,
                    confidence: meta.confidence != null ? Math.round(meta.confidence * 100) : undefined,
                    sources: (meta.hits ?? []).map((h: any) => ({
                      page_id: h.page_id ?? h.chunk_id ?? String(h.title ?? ""),
                      title: h.title ?? "Knowledge source",
                      space: h.domain ?? h.space ?? "",
                      excerpt: h.text ?? h.excerpt ?? "",
                      relevance: h.score != null ? Math.round(h.score * 100) : undefined,
                      url: h.source_url ?? null,
                    })) as Source[],
                  }
                : m,
            ),
          );
          setIsTyping(false);
          setStage(undefined);
        },
      }).catch((err: any) => {
        // Auto-retry up to 2 attempts, then surface a manual Retry button
        if (attempt < 2) {
          setStage("Reconnecting");
          setTimeout(() => runQuestion(question, { replaceBotId: botId, attempt: attempt + 1 }), 1200);
          return;
        }
        const detail = String(err?.message || "");
        const msg = /expired|401/i.test(detail)
          ? "⚠️ Session expired — please reload the page to sign in again."
          : /403/i.test(detail)
            ? "⚠️ Access denied for this question (RBAC)."
            : "⚠️ Connection error — the assistant could not be reached.";
        setMessages((p) =>
          p.map((m) =>
            m.id === botId
              ? { ...m, failed: true, retryQuestion: question, content: msg }
              : m,
          ),
        );
        setIsTyping(false);
        setStage(undefined);
      });
    },
    [messages, sessionRef],
  );

  const send = useCallback(() => {
    const q = input.trim();
    if (!q || isTyping) return;
    setInput("");
    runQuestion(q);
  }, [input, isTyping, runQuestion]);

  /** v1.6.45 — re-run the question that produced this answer. Useful when the
   *  answer was cut short, degraded by a rerank timeout, or when the user simply
   *  wants a second sample from the model. */
  const regenerate = useCallback(
    (botId: string) => {
      if (isTyping) return;
      const idx = messages.findIndex((m) => m.id === botId);
      if (idx < 1) return;
      const q = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!q) return;
      runQuestion(q.content, { replaceBotId: botId });
    },
    [messages, isTyping, runQuestion],
  );

  /** Share the answer: native sheet where available, clipboard as the fallback. */
  const shareText = useCallback(async (text: string) => {
    const nav = navigator as Navigator & {
      share?: (d: { title: string; text: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ title: "IT Knowledge Assistant", text });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flashNotice("Copied to clipboard");
    } catch {
      flashNotice("Could not share on this device");
    }
  }, [flashNotice]);

  const retryFailed = useCallback(
    (botMsg: Msg) => {
      if (isTyping) return;
      // find the user question immediately before this failed bubble
      const idx = messages.findIndex((m) => m.id === botMsg.id);
      const q = messages[idx - 1]?.content ?? botMsg.retryQuestion ?? "";
      if (!q) return;
      runQuestion(q, { replaceBotId: botMsg.id });
    },
    [messages, isTyping, runQuestion],
  );

  const startEdit = useCallback((msg: Msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
  }, []);

  const submitEdit = useCallback(() => {
    const q = editText.trim();
    if (!q || isTyping) return;
    const idx = messages.findIndex((m) => m.id === editingId);
    if (idx === -1) return;
    // drop everything from the edited user message onward, then re-ask
    setMessages((p) => p.slice(0, idx));
    setEditingId(null);
    setEditText("");
    runQuestion(q);
  }, [editText, isTyping, messages, editingId, runQuestion]);

  /* Minimized: round bubble bottom-right, conversation state preserved */
  if (open && minimized) {
    return (
      <button
        aria-label="Reopen chat"
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-50 grid size-14 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-2xl shadow-black/30 transition hover:scale-105 hover:opacity-95"
      >
        <Bot className="size-6" />
        {messages.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid size-5 place-items-center rounded-full border-2 border-white bg-emerald-500 text-2xs font-bold text-white dark:border-[#0B1220]">
            {messages.filter((m) => m.role === "assistant" && !m.failed).length || "•"}
          </span>
        )}
      </button>
    );
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="AI assistant chat"
      className="fixed bottom-5 right-5 z-50 flex h-[520px] w-[380px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-violet-800/40 bg-gradient-to-r from-violet-700 to-violet-800 px-4 py-3 text-white">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20 border border-white/25">
          <Bot className="size-5 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white leading-tight">IT Assistant</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-400" />
            <span className="text-xs text-white/80">IT Knowledge Assistant - RBAC protected</span>
          </div>
        </div>
        <button
          aria-label="Minimize chat"
          title="Minimize"
          onClick={() => setMinimized(true)}
          className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <Minus className="size-4" />
        </button>
        <button
          aria-label="Close chat"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-white/80 transition hover:bg-white/20 hover:text-white"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Body */}
      <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto bg-background p-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-violet-600/20 text-violet-400 border border-violet-500/30 shadow-sm">
              <Sparkles className="size-6 text-violet-400" />
            </div>
            <h3 className="mt-3.5 text-base font-bold text-foreground">Ask an IT question</h3>
            <p className="mt-1.5 max-w-[260px] text-xs leading-relaxed text-muted-foreground">
              I answer from your organization&apos;s knowledge base and cite the pages I used.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "group flex justify-end" : "group flex justify-start gap-2"}>
            {/* v1.6.38 — brand avatar on assistant turns, matching the Chat page */}
            {m.role !== "user" && (
              <div className="grid size-7 shrink-0 place-items-center rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] shadow-sm">
                <Bot className="size-3.5" />
              </div>
            )}
            <div className={m.role === "user" ? "max-w-[85%]" : "min-w-0 max-w-[88%]"}>
              <div
                className={[
                  "min-w-0 max-w-full overflow-hidden rounded-2xl px-3.5 py-3 text-xs leading-relaxed",
                  m.role === "user"
                    ? editingId === m.id
                      ? "rounded-br-md border-2 border-[var(--primary)] bg-[var(--accent-soft)]"
                      : "rounded-br-md bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : m.failed
                      ? "rounded-tl-none border border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                      : "rounded-tl-none border border-slate-200 bg-white text-slate-800 shadow-xs dark:border-slate-800 dark:bg-[#111827] dark:text-slate-100",
                ].join(" ")}
              >
                {m.role === "user" ? (
                  editingId === m.id ? (
                    <div>
                      <textarea
                        ref={editRef}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                          if (e.key === "Escape") { setEditingId(null); setEditText(""); }
                        }}
                        rows={2}
                        className="w-full resize-none rounded-lg border border-[var(--border)] bg-background p-2 text-xs text-foreground outline-none"
                       aria-label="Edit message"/>
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button
                          onClick={() => { setEditingId(null); setEditText(""); }}
                          className="rounded-md px-2 py-1 text-2xs font-medium text-slate-500 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={submitEdit}
                          disabled={!editText.trim()}
                          className="rounded-md bg-[var(--primary)] px-2.5 py-1 text-2xs font-semibold text-[var(--primary-foreground)] hover:opacity-90 disabled:opacity-50"
                        >
                          Resend
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )
                ) : (
                  <>
                    {/* v1.6.45 — the shared MarkdownMessage owns the answer styling, so
                        the chat page and this widget render identically (including the
                        one-click Copy button on code blocks). `compact` scales it down
                        for the 380px widget. */}
                    <div className="contents">
                      {preferences.markdown_rendering
                        ? <MarkdownMessage content={m.content} compact />
                        : <p className="whitespace-pre-wrap">{m.content}</p>}
                    </div>
                    {m.failed && (
                      <button
                        onClick={() => retryFailed(m)}
                        disabled={isTyping}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-2.5 py-1.5 text-2xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                      >
                        <RefreshCw className={`size-3 ${isTyping ? "animate-spin" : ""}`} />
                        Retry
                      </button>
                    )}
                    {preferences.show_rag_sources && (m.sources?.length ?? 0) > 0 && (
                      <div className="mt-2 border-t border-[var(--border)] pt-2">
                        <div className="mb-1 flex items-center gap-1 text-2xs font-semibold text-muted-foreground">
                          <Sparkles className="size-3 text-[var(--primary)]" /> Sources
                        </div>
                        {m.sources!.slice(0, 3).map((s, i) => (
                          <div key={i} className="mb-1 truncate rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-2xs text-[var(--accent-foreground)]">
                            📄 {s.title}
                            {s.relevance != null && <span className="ml-1 text-emerald-600 dark:text-emerald-400">{s.relevance}%</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.confidence != null && (
                      <div className="mt-1.5 text-2xs text-muted-foreground">
                        Confidence:{" "}
                        <span className={m.confidence >= 85 ? "font-semibold text-emerald-600" : m.confidence >= 70 ? "font-semibold text-amber-600" : "font-semibold text-red-500"}>
                          {m.confidence >= 85 ? "High" : m.confidence >= 70 ? "Medium" : "Low"} ({m.confidence}%)
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Message actions (hover) — copy / share, plus edit-and-resend on the
                  question and re-generate on the newest answer (v1.6.45). */}
              <div className={`mt-1 flex items-center gap-1 ${m.role === "user" ? "justify-end" : ""}`}>
                <CopyButton getText={() => m.content} label={m.role === "user" ? "Copy question" : "Copy answer"} />
                <button
                  type="button"
                  title="Share this answer"
                  aria-label="Share this answer"
                  onClick={() => shareText(m.content)}
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
                >
                  <Share2 className="size-3" />
                </button>
                {m.role === "assistant" && !isTyping && m.id === messages[messages.length - 1]?.id && (
                  <button
                    type="button"
                    title="Re-generate this answer"
                    aria-label="Re-generate this answer"
                    onClick={() => regenerate(m.id)}
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                )}
                {m.role === "user" && editingId !== m.id && (
                  <button
                    type="button"
                    title="Edit & resend"
                    aria-label="Edit and resend this question"
                    onClick={() => startEdit(m)}
                    className="rounded-md p-1 text-muted-foreground opacity-0 transition hover:bg-black/5 hover:text-foreground group-hover:opacity-100 dark:hover:bg-white/10"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isTyping && (
          /* v1.6.38 — matched to the Chat page: brand avatar + orbiting ring, a
             stage icon that changes as the pipeline advances, and a shimmering
             label (Thinking -> Rewriting -> Searching -> Researching -> Writing). */
          <div className="flex justify-start">
            <div className="min-w-0 max-w-[92%] rounded-2xl rounded-tl-none border border-slate-200 bg-white px-3.5 py-3 shadow-xs dark:border-slate-800 dark:bg-[#111827]">
              <AgentActivity
                stage={stageFromText(stage)}
                detail={stage}
                elapsedMs={elapsedMs}
                compact
              />
            </div>
          </div>
        )}
      </div>

      {/* v1.6.45 — transient confirmation for copy / share */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-[74px] z-10 mx-auto w-fit rounded-full bg-slate-900/90 px-3 py-1 text-2xs font-medium text-white shadow-lg dark:bg-slate-100/95 dark:text-slate-900"
        >
          {notice}
        </div>
      )}

      {/* Composer — the same component the chat page uses, so the two cannot drift. */}
      <div className="shrink-0 border-t border-[var(--border)] bg-card p-2.5">
        <form onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={send}
            busy={isTyping}
            hint={false}
            multiline={false}
            placeholder="Ask an IT question..."
            aria-label="Ask a question"
            className="border-[var(--border)] bg-muted/40 focus-within:border-violet-500/60 focus-within:ring-2 focus-within:ring-violet-500/10"
            onAttach={async (f: File) => {
              try { await uploadAttachment(f, sessionRef); } catch { /* non-blocking */ }
            }}
          />
        </form>
        <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <Shield className="size-3 text-muted-foreground" />
          AI answers may require verification - RBAC protected
        </div>
      </div>
    </div>
  );
}
