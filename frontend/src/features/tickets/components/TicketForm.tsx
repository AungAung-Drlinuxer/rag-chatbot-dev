/**
 * The ticket form — the fields, once.
 *
 * Create (Tickets page), review (a chat answer's draft) and edit (an existing issue) all
 * write the same Jira issue, so they must ask for the same things in the same order and in
 * the same grammar: 10 px radius, 40 px fields, normal-case labels, a counter on the two
 * fields with limits, and the Jira-only fields last with their format stated.
 *
 * Callers own the state and the submit. This file owns nothing but the shape of the form,
 * so a field added here appears in all three places instead of in whichever one someone
 * remembered to update.
 */
import { AlertCircle, CalendarDays, Sparkles } from "lucide-react";

import type { CategoryAssignee } from "@/features/tickets/api";

export type TicketFormValues = {
  subject: string;
  description: string;
  /** The domain *label* ("Network"), which is what the create and edit APIs take. */
  category: string;
  priority: string;
  assignee: string;
  due_date: string;
  /** Comma-separated in the form; the API call splits them. */
  components: string;
  labels: string;
  original_estimate: string;
};

export const EMPTY_TICKET_FORM: TicketFormValues = {
  subject: "",
  description: "",
  category: "",
  priority: "medium",
  assignee: "",
  due_date: "",
  components: "",
  labels: "",
  original_estimate: "",
};

export const SUBJECT_MAX = 200;
export const DESCRIPTION_MAX = 2000;

export const FIELD =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15";

const LABEL = "mb-1.5 block text-xs font-medium text-foreground";
const HINT = "mt-1 block text-[11px] leading-snug text-muted-foreground";

export const PRIORITY_GUIDE: Record<string, string> = {
  critical: "A service is down for everyone. Nothing else matters.",
  high: "Work is blocked for a person or a team, with no workaround.",
  medium: "Degraded or inconvenient, but there is a way to keep working.",
  low: "A question, a cosmetic issue, or a request with no deadline.",
};

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-[var(--danger)]",
  high: "bg-[var(--warn)]",
  medium: "bg-[var(--primary)]",
  low: "bg-[var(--muted-foreground)]",
};

type Props = {
  values: TicketFormValues;
  onChange: (patch: Partial<TicketFormValues>) => void;
  categories: { key: string; label: string }[];
  assignable: CategoryAssignee[];
  /** "category" when the domain maps a team, "all" when it falls back to the directory. */
  assigneeScope?: "category" | "all";
  /** Only shown once the reporter has tried to submit. */
  errors?: { subject?: boolean; description?: boolean };
  /** Rewrite the description in place; hidden when the caller cannot do it. */
  onImprove?: () => void;
  improving?: boolean;
  subjectRef?: React.Ref<HTMLInputElement>;
};

export function TicketFormFields({
  values,
  onChange,
  categories,
  assignable,
  assigneeScope = "all",
  errors,
  onImprove,
  improving,
  subjectRef,
}: Props) {
  const missingSubject = Boolean(errors?.subject);
  const missingDescription = Boolean(errors?.description);
  const selected = assignable.find((u) => u.username === values.assignee);

  return (
    <div className="space-y-4">
      {/* ---- subject ---- */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label htmlFor="ticket-subject" className={LABEL}>
            Subject <span className="text-[var(--danger)]">*</span>
          </label>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {values.subject.length} / {SUBJECT_MAX}
          </span>
        </div>
        <input
          id="ticket-subject"
          ref={subjectRef}
          value={values.subject}
          maxLength={SUBJECT_MAX}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder="Briefly describe the issue…"
          aria-label="Subject"
          aria-invalid={missingSubject || undefined}
          className={[FIELD, missingSubject ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15" : ""].join(" ")}
        />
        {missingSubject && (
          <p className="mt-1 flex items-center gap-1 text-2xs text-[var(--danger)]">
            <AlertCircle className="size-3" /> A subject is what the queue shows first.
          </p>
        )}
      </div>

      {/* ---- description ---- */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor="ticket-description" className={LABEL}>
            Description <span className="text-[var(--danger)]">*</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {values.description.length} / {DESCRIPTION_MAX}
            </span>
            {onImprove && (
              <button
                type="button"
                /* Improve, not generate: the reporter's own words go in and a clearer version
                   of them comes back. */
                disabled={improving || !values.description.trim()}
                title="Rewrite what you typed as a clearer ticket description"
                onClick={onImprove}
                className="inline-flex items-center gap-1.5 rounded-md border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--primary)] transition hover:bg-[var(--primary)]/20 disabled:opacity-40"
              >
                <Sparkles className="size-3" />
                {improving ? "Improving…" : "Improve with AI"}
              </button>
            )}
          </div>
        </div>
        <textarea
          id="ticket-description"
          rows={4}
          value={values.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="What happened, any error messages, the affected system, and what you already tried…"
          aria-label="Ticket description"
          aria-invalid={missingDescription || undefined}
          className={[
            "w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15",
            missingDescription ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15" : "",
          ].join(" ")}
        />
        {missingDescription && (
          <p className="mt-1 flex items-center gap-1 text-2xs text-[var(--danger)]">
            <AlertCircle className="size-3" /> Say what happened — IT cannot act on a title alone.
          </p>
        )}
      </div>

      {/* ---- category + priority ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>
            Category <span className="text-[var(--danger)]">*</span>
          </span>
          <select
            id="ticket-category"
            value={values.category}
            onChange={(e) => onChange({ category: e.target.value, assignee: "" })}
            aria-label="Category"
            className={FIELD}
          >
            <option value="">Select a category…</option>
            {categories.map((c) => (
              <option key={c.key} value={c.label}>{c.label}</option>
            ))}
          </select>
        </label>

        <div>
          <div className={`${LABEL} flex items-center justify-between`}>
            <span>Priority</span>
            <span className="flex items-center gap-1.5 text-[11px] font-normal capitalize text-muted-foreground">
              <span className={["size-1.5 rounded-full", PRIORITY_DOT[values.priority] ?? PRIORITY_DOT.medium].join(" ")} />
              {values.priority}
            </span>
          </div>
          <select
            id="ticket-priority"
            value={values.priority}
            onChange={(e) => onChange({ priority: e.target.value })}
            aria-label="Priority"
            className={FIELD}
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <span className={HINT}>{PRIORITY_GUIDE[values.priority] ?? PRIORITY_GUIDE.medium}</span>
        </div>
      </div>

      {/* ---- assignee + due date ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Assignee</span>
          <select
            id="ticket-assignee"
            value={values.assignee}
            onChange={(e) => onChange({ assignee: e.target.value })}
            aria-label="Assignee"
            className={FIELD}
          >
            <option value="">Unassigned</option>
            {Object.entries(
              assignable.reduce<Record<string, CategoryAssignee[]>>((acc, u) => {
                const g = u.group || (assigneeScope === "category" ? "Category team" : "Everyone");
                (acc[g] ??= []).push(u);
                return acc;
              }, {}),
            ).map(([group, users]) => (
              <optgroup key={group} label={group}>
                {users.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username}{u.jira_account === false ? " — no Jira account" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className={HINT}>
            {assigneeScope === "category"
              ? `Only people mapped to ${values.category} can be picked.`
              : "No team is mapped to this category yet — showing every assignable user."}
          </span>
          {selected?.jira_account === false && (
            <span className="mt-1 block rounded-md border border-[var(--warn)]/40 bg-[var(--warn)]/10 px-2 py-1 text-[11px] leading-snug text-[var(--warn)]">
              {selected.username} has no Jira account, so Jira will leave this ticket unassigned.
            </span>
          )}
        </label>

        <div>
          <label htmlFor="ticket-due-date" className={LABEL}>Due date</label>
          <div className="relative">
            <input
              id="ticket-due-date"
              type="date"
              value={values.due_date}
              onChange={(e) => onChange({ due_date: e.target.value })}
              aria-label="Due date"
              /* No painted placeholder over a date input: WebKit on phones ignores the rule
                 that hides the native text, so an overlay doubled the value. */
              className={[
                FIELD,
                "pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
              ].join(" ")}
            />
            <CalendarDays className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>
        </div>
      </div>

      {/* ---- Jira create-screen extras ---- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="ticket-components" className={LABEL}>Components</label>
          <input
            id="ticket-components"
            value={values.components}
            onChange={(e) => onChange({ components: e.target.value })}
            placeholder="Network & VPN, macOS"
            className={FIELD}
          />
          <p className={HINT}>Comma separated; must exist in Jira.</p>
        </div>
        <div>
          <label htmlFor="ticket-labels" className={LABEL}>Labels</label>
          <input
            id="ticket-labels"
            value={values.labels}
            onChange={(e) => onChange({ labels: e.target.value })}
            placeholder="vpn, macos"
            className={FIELD}
          />
          <p className={HINT}>Comma separated, free form.</p>
        </div>
        <div>
          <label htmlFor="ticket-estimate" className={LABEL}>Original estimate</label>
          <input
            id="ticket-estimate"
            value={values.original_estimate}
            onChange={(e) => onChange({ original_estimate: e.target.value })}
            placeholder="2h · 1d 4h"
            className={FIELD}
          />
          <p className={HINT}>Jira format: w d h m.</p>
        </div>
      </div>
    </div>
  );
}

export default TicketFormFields;
