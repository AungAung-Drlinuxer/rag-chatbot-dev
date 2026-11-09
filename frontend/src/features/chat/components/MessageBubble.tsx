/**
 * MessageBubble — one chat message (v1.6.68, extracted from ChatPage).
 *
 * Extracted because ChatPage.tsx had grown past 1,700 lines with this component
 * accounting for ~410 of them: every UI change meant editing one very large file, and
 * this session produced two syntax errors doing exactly that. It is self-contained
 * (it defines its own copyText), so the move is mechanical.
 *
 * v1.0.2 — restyled to the reference answer card. The assistant reply is a bordered
 * CARD with a header row (avatar · IT Assistant · provenance), the prose body, an
 * optional sources list headed "Sources for this answer", the persisted RAG trace, a
 * metadata line (time · confidence · tokens) and the "Was this helpful?" action row.
 * Colours are the app's design tokens (--border, --accent, --primary) rather than the
 * mockup's literal hexes, so the card follows both themes. Everything the card shows
 * is a value the message already carries — no figure is invented to fill it out.
 */
import { AlertTriangle, Bot, Check, CheckCircle2, Clock3, Copy, ExternalLink, Pencil, RotateCcw, Share2, ShieldAlert, Sparkles, Ticket, User, Zap } from "lucide-react";

import AgentActivity, { stageFromText } from "@/components/AgentActivity";
import MarkdownMessage from "@/components/MarkdownMessage";
import { ConfidenceBadge } from "@/features/chat/components/MessageParts";
import { groupSources, matchLabel, referenceLabel } from "@/features/chat/sources";
import RagPipelineStatus from "@/features/chat/components/RagPipelineStatus";
import { useState } from "react";

import { type Message } from "@/features/chat/model";

function MessageBubble({
  message,
  onHelpful,
  onNotHelpful,
  onOpenTicketForm,
  onSubmitEdit,
  onRetryQuestion,
  busy = false,
  liveStageText,
  liveElapsedMs,
  showSources = true,
  showTokenUsage = true,
  markdownRendering = true,
}: {
  message: Message;
  onHelpful: () => void;
  onNotHelpful: () => void;
  onOpenTicketForm: () => void;
  onSubmitEdit?: (messageId: string, newText: string) => void;
  onRetryQuestion?: () => void;
  /** v1.6.65 — re-ask the same question against the live estate (KB answers only). */
  busy?: boolean;
  /** v1.6.38 — live pipeline stage (detail text) for the animated indicator */
  liveStageText?: string;
  liveElapsedMs?: number;
  showSources?: boolean;
  showTokenUsage?: boolean;
  markdownRendering?: boolean;
}) {
  const isUser = message.role === "user";
  const caution = message.decision === "caution";
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);


  /* The card header's one-line provenance. It describes where the answer came from and
     never invents a domain, a score or a count — the mockup's subtitle names a support
     area, but nothing in the message payload carries one. */
  const provenance = "Grounded in your knowledge base";

  /* Grouped once so the count line and the cards below are derived from the same list:
     the heading used to count raw rows ("7 references") above a list of four. */
  const sourceGroups = groupSources(message.sources ?? []);

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard API unavailable (http) — fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function shareText(text: string) {
    const nav = navigator as Navigator & { share?: (d: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "IT Help Chatbot", text }); return; } catch { /* cancelled */ }
    }
    await copyText(text); // share unsupported -> copy as fallback
    setShared(true);
    window.setTimeout(() => setShared(false), 1600);
  }

  /* ---------------- the user turn: a bubble, as before ---------------- */
  if (isUser) {
    return (
      <div className="group/msg flex justify-end gap-3">
        <div className="min-w-0 max-w-[85%]">
          <div className="min-w-0 max-w-full overflow-hidden rounded-2xl rounded-br-md bg-[var(--primary)] px-5 py-3.5 text-[13.5px] leading-[1.7] text-[var(--primary-foreground)]">
            {editing ? (
              /* v1.3.1 — in-place edit (ChatGPT-style): textarea inside the bubble */
              <div className="flex flex-col gap-2">
                <textarea
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    } else if (e.key === "Escape") {
                      setEditing(false);
                      setEditDraft(message.content);
                    }
                  }}
                  rows={Math.min(6, Math.max(2, editDraft.split("\n").length))}
                  className="w-full resize-none rounded-xl bg-white/95 px-3 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:bg-slate-900/95 dark:text-slate-100"
                 aria-label="Edit message"/>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setEditDraft(message.content); }}
                    className="rounded-lg border border-white/40 px-2.5 py-1 text-2xs font-medium text-white/80 transition hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!editDraft.trim() || editDraft === message.content}
                    onClick={() => {
                      if (editDraft.trim() && editDraft !== message.content) {
                        onSubmitEdit?.(message.id, editDraft.trim());
                      }
                      setEditing(false);
                    }}
                    className="rounded-lg bg-white px-2.5 py-1 text-2xs font-semibold text-[var(--primary)] transition hover:bg-blue-50 disabled:opacity-50"
                  >
                    Save &amp; resend
                  </button>
                </div>
              </div>
            ) : (
              <div className="min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {message.content || "..."}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              <Clock3 className="size-3" />
              {message.timestamp}
            </span>
            {/* v1.1.2 — always-visible compact icons (hover-only hid them on touch devices):
                Edit query / Copy query / Retry
                S3.10 — icons were 14px with a ~21px hit area; 16px icons inside a
                30px target meet the minimum comfortable touch/click size. */}
            <span className="flex items-center gap-0.5">
              <button type="button" title="Edit query — edit in place and resend"
                aria-label="Edit query"
                onClick={() => { setEditDraft(message.content); setEditing(true); }}
                className="grid size-[30px] place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <Pencil className="size-4" />
              </button>
              <button type="button" title="Copy query" aria-label="Copy query"
                onClick={() => copyText(message.content)}
                className="grid size-[30px] place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
                {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
              </button>
              <button type="button" title="Retry — re-run this question" aria-label="Retry question"
                onClick={() => onRetryQuestion?.()}
                className="grid size-[30px] place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <RotateCcw className="size-4" />
              </button>
            </span>
          </div>
        </div>

        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--secondary)] text-[var(--secondary-foreground)]">
          <User className="size-4" />
        </div>
      </div>
    );
  }

  /* ---------------- the assistant turn: the answer card ---------------- */
  return (
    <div className="group/msg flex justify-start gap-3">
      <article className="min-w-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
        {/* ---- card header: avatar · IT Assistant · provenance ---- */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-[var(--border)] px-4 py-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">IT Assistant</div>
            <div className="text-2xs text-muted-foreground">{provenance}</div>
          </div>
        </div>

        {/* ---- body ---- */}
        <div className="px-4 py-3.5 text-[13.5px] leading-[1.7] text-foreground">
          {message.content ? (
            markdownRendering
              ? <MarkdownMessage content={message.content} />
              : <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
          ) : busy ? (
            /* v1.6.45 — the animated agent indicator, restored after the markdown
               renderer was extracted into MarkdownMessage. */
            <AgentActivity
              stage={stageFromText(liveStageText)}
              detail={liveStageText}
              elapsedMs={liveElapsedMs}
            />
          ) : (message as any).guardrail ? (
            <div className="flex items-start gap-2 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <div className="flex flex-col gap-1">
                <div className="font-medium">Blocked by content security policy ({(message as any).guardrail}).</div>
                <p className="text-2xs text-muted-foreground">
                  Your message triggered the input guardrail (v1.1.4). No data was sent to the AI
                  provider. Rephrase your question — if you believe this is an error, contact IT.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-muted-foreground">
              <div className="font-medium text-rose-600">No answer received from the AI provider.</div>
              <p className="text-2xs">
                The pipeline ran (retrieval + generation) but the upstream model returned no
                content — this is usually a free-tier rate limit or invalid model name. Try
                again, or change the model in <strong>Settings → Integrations → Models Provider</strong>.
              </p>
            </div>
          )}

          {/* v1.6.60 — sources are documents, so they are evidence only for a
              documents answer. A live-infrastructure answer is evidenced by the
              cluster, and listing KB articles under it claims a provenance the answer
              does not have. The backend no longer sends them; this guard means a stale
              conversation or a cached payload cannot reintroduce them either. */}
          {showSources && (message.sources?.length ?? 0) > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-foreground">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-[var(--primary)]" />
                  Sources for this answer
                </span>
                {/* The mockup's count line gives BOTH figures: the references that came
                    back and the distinct titles they collapse to. The list below is
                    grouped the same way, so the two numbers cannot disagree. */}
                <span className="shrink-0 text-2xs font-normal text-muted-foreground">
                  {referenceLabel(message.sources!.length)} · {sourceGroups.length} grouped{" "}
                  {sourceGroups.length === 1 ? "title" : "titles"}
                </span>
              </div>
              {/* Two columns from sm up — the mockup lays the grouped titles out in a
                  grid, and one full-width row per source turned four short titles into
                  four very wide bars. */}
              <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {sourceGroups.map((g, idx) => {
                  const s = g.source;
                  const match = matchLabel(g);
                  const content = (
                    <div className="flex h-full items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-2.5 transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent-soft)]">
                      <div className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-2xs font-bold text-[var(--accent-foreground)]">
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground" title={s.title}>
                          {s.title}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
                          <span>{referenceLabel(g.count)}</span>
                          {match && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                {match}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {s.url && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
                    </div>
                  );
                  return (
                    <li key={g.key}>
                      {s.url ? (
                        <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Open “${s.title}” in a new tab`}
                        className="block h-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40"
                      >
                          {content}
                        </a>
                      ) : (
                        content
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Persisted RAG Execution Pipeline Trace inside Assistant Message Bubble */}
          {message.ragTrace && (
            <div className="mt-4 border-t border-[var(--border)] pt-3">
              <RagPipelineStatus
                active={false}
                stage=""
                telemetry={message.ragTrace.stages}
                elapsedMs={message.ragTrace.totalMs}
                defaultOpen={false}
              />
            </div>
          )}
        </div>

        {/* ---- metadata line: time · confidence · tokens ---- */}
        {/* The mockup's line is exactly these three facts and nothing else. The Copy /
            Share pair that used to sit here duplicated the footer actions two rows
            below — which is where the eye already is at the end of a long answer. Share
            moved down to that row rather than being dropped. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-4 py-2.5">
          <span className="flex items-center gap-1 text-2xs text-muted-foreground">
            <Clock3 className="size-3" />
            {message.timestamp}
          </span>
          {message.confidence != null && (
            <ConfidenceBadge confidence={message.confidence} />
          )}
          {showTokenUsage && (message.usage?.input_tokens != null || message.usage?.output_tokens != null) && (
            <span
              className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-2xs font-medium text-[var(--muted-foreground)]"
              title={message.latencyMs ? `Generated in ${(message.latencyMs / 1000).toFixed(1)}s` : undefined}
            >
              <Zap className="size-3 text-amber-500" />
              {/* The mockup spells both figures out ("2,915 input / 1,465 output
                  tokens") instead of the old "1840 in · 210 out = 2,050 tokens", which
                  made the reader add the two numbers up to check the total. */}
              {(message.usage?.input_tokens ?? 0).toLocaleString()} input /{" "}
              {(message.usage?.output_tokens ?? 0).toLocaleString()} output tokens
              {message.latencyMs ? <span className="text-muted-foreground/70">· {(message.latencyMs / 1000).toFixed(0)}s</span> : null}
            </span>
          )}
          {caution && (
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-2xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="size-3" />
              caution — verify before proceeding
            </span>
          )}
        </div>

        {message.content && (
          /* Icon-only action row. The "Was this helpful?" caption and the button labels
             made the footer twice as wide as the mockup's, so each action keeps only its
             icon — with aria-label and title carrying the meaning for hover, screen
             readers and the tests. Copy and Share reset to their idle icon after a beat
             (the tick is the confirmation). */
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-4 py-2.5">
            <button
              onClick={() => onHelpful()}
              disabled={busy}
              aria-label="Mark answer helpful"
              aria-pressed={message.feedback === 1}
              title={message.serverId ? "Helpful" : "Answer not saved yet"}
              className={[
                "grid size-8 place-items-center rounded-full border transition",
                message.feedback === 1
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "border-[var(--border)] bg-card text-foreground hover:bg-muted",
              ].join(" ")}
            >
              <CheckCircle2 className="size-4" />
            </button>
            <button
              onClick={() => onNotHelpful()}
              disabled={busy}
              aria-label="Mark answer not helpful"
              aria-pressed={message.feedback === -1}
              title={message.serverId ? "Not helpful" : "Answer not saved yet"}
              className={[
                "grid size-8 place-items-center rounded-full border transition",
                message.feedback === -1
                  ? "border-amber-500 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  : "border-[var(--border)] bg-card text-foreground hover:bg-muted",
              ].join(" ")}
            >
              <AlertTriangle className="size-4" />
            </button>

            <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--border)]" />

            <button
              type="button"
              title={copied ? "Copied" : "Copy answer"}
              aria-label={copied ? "Copied" : "Copy answer"}
              onClick={() => copyText(message.content)}
              className="grid size-8 place-items-center rounded-full border border-[var(--border)] bg-card text-foreground transition hover:bg-muted"
            >
              {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
            </button>
            <button
              type="button"
              title={shared ? "Shared" : "Share answer"}
              aria-label={shared ? "Shared" : "Share answer"}
              onClick={() => shareText(message.content)}
              className="grid size-8 place-items-center rounded-full border border-[var(--border)] bg-card text-foreground transition hover:bg-muted"
            >
              {shared ? <Check className="size-4 text-emerald-500" /> : <Share2 className="size-4" />}
            </button>
            <button
              type="button"
              title="Create Jira ticket"
              aria-label="Create Jira ticket"
              onClick={onOpenTicketForm}
              className="ml-auto grid size-8 place-items-center rounded-full border border-orange-200 bg-orange-50/80 text-orange-700 transition hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300"
            >
              <Ticket className="size-4" />
            </button>
          </div>
        )}
      </article>
    </div>
  );
}

/* ============================================================
   CONFIDENCE / SOURCES
============================================================ */


export default MessageBubble;
