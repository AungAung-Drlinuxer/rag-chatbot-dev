import { CalendarDays, CheckCircle2, ExternalLink, Loader2, Pencil, Sparkles, Ticket, User } from "lucide-react";

import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import type { TicketDraft } from "@/features/chat/model";

/** What the create call actually returned. Kept next to the draft it came from so an old
 *  answer still shows its own ticket after the conversation moves on. */
export type CreatedTicket = { key: string; link?: string };

const PRIORITY_TONE: Record<string, string> = {
  critical: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--danger)]",
  high: "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-[var(--warn)]",
  medium: "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]",
  low: "border-[var(--border)] bg-[var(--muted)]/50 text-muted-foreground",
};

export function ChatTicketCard({
  draft,
  created,
  domainLabel,
  busy,
  onEdit,
  onCreate,
}: {
  draft: TicketDraft;
  created?: CreatedTicket | null;
  domainLabel?: string;
  busy?: boolean;
  onEdit: () => void;
  onCreate: () => void;
}) {
  /* ---- already created: the card stops being a decision and becomes a receipt ---- */
  if (created) {
    return (
      <div
        data-slot="chat-ticket-created"
        className="m-4 mt-0 rounded-xl border border-[var(--ok)]/35 bg-[var(--ok)]/[0.07] p-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ok)]">
            <CheckCircle2 className="size-4" />
            Jira ticket created
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ok)]/35 bg-[var(--ok)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--ok)]">
            Synced with Jira
          </span>
        </div>

        <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{draft.subject}</p>
        <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
          {draft.description}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--ok)]/25 pt-2.5">
          <a
            href={created.link || "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--ok)] px-2.5 py-1 font-mono text-[11px] font-bold text-white transition hover:opacity-90"
          >
            {created.key}
            <ExternalLink className="size-3" />
          </a>
          <span className="text-[11px] text-muted-foreground">
            {domainLabel || draft.domain} · Priority: <strong className="text-foreground">{draft.priority}</strong>
          </span>
        </div>
      </div>
    );
  }

  /* ---- draft: a review, not a form ---- */
  return (
    <div
      data-slot="chat-ticket-draft"
      className="m-4 mt-0 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-2 py-0.5 text-[11px] font-semibold text-foreground">
            <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3" />
            Jira · Task
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
            <Sparkles className="size-3" /> AI extracted
          </span>
        </span>
        <span
          className={[
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
            PRIORITY_TONE[draft.priority] || PRIORITY_TONE.medium,
          ].join(" ")}
        >
          {draft.priority}
        </span>
      </div>

      <h4 className="mt-2.5 text-sm font-semibold leading-snug text-foreground">{draft.subject}</h4>
      <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
        {draft.description}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-[var(--muted)]/50 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
          <Ticket className="size-3" /> {domainLabel || draft.domain}
        </span>
        {draft.assignee && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--muted)]/50 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            <User className="size-3" /> {draft.assignee}
          </span>
        )}
        {draft.due_date && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[var(--muted)]/50 px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            <CalendarDays className="size-3" /> Due {draft.due_date}
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2.5">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-b from-[var(--brand-grad-from)] to-[var(--brand-grad-to)] px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Ticket className="size-3.5" />}
          {busy ? "Creating in Jira…" : "Create ticket"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-60"
        >
          <Pencil className="size-3.5" />
          Edit details
        </button>
      </div>
    </div>
  );
}

export default ChatTicketCard;
