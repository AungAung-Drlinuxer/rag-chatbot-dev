/**
 * Create-ticket dialog — the one form, used by the Tickets page and by the chat answer's
 * "Create Jira ticket" action.
 *
 * WHY ONE COMPONENT: the chat used to open its own two-field dialog (summary + description,
 * priority pinned to medium, no category, assignee, due date or attachments), so the same
 * action produced weaker tickets depending on where it was started. The board and the
 * conversation now mount the same form; the chat only presets the subject/description and
 * passes the session id so the ticket keeps its link back to the conversation.
 *
 * The dialog owns its own data: categories come from the live domain list, assignees from the
 * user directory, and whether Jira is configured from the destinations endpoint — so neither
 * caller has to fetch or pass them.
 *
 * The shape of the screen follows one column, top to bottom: what this is and where it lands
 * (header + Jira pill), the three templates that fill the boring half of the form, the two
 * fields the reporter actually has to write, then the optional context as two tidy rows.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Bug, CalendarDays, Cloud, KeyRound, Paperclip,
  Send, Sparkles, Ticket as TicketIcon, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTicketApi,
  listActiveDomains,
  improveTicketDescription,
  listTicketDestinations,
  ticketAssignees,
  ticketAttachmentAdd,
} from "@/features/tickets/api";

export type CreateTicketPreset = {
  subject?: string;
  description?: string;
  sessionId?: string | null;
  /** The routing domain the assistant filed the answer under. Seeds the category, which in
   *  turn seeds the request type, the project and the assignee pool — Jira Service Management
   *  routes by request type, so a ticket with no category is a ticket nobody owns. */
  domain?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled values — the chat answer's own text, when opened from a message. */
  preset?: CreateTicketPreset;
  /** Called after Jira accepted the issue; the caller refreshes its own list. */
  onCreated?: (created: any) => void;
  onToast?: (message: string, tone?: "ok" | "err") => void;
};

const EMPTY = {
  subject: "",
  description: "",
  category: "General",
  priority: "medium",
  assignee: "",
  due_date: "",
};

const MAX_SUBJECT = 100;
const MAX_DESCRIPTION = 2000;

/** What each priority means, said once — a select of four adjectives is a guess. */
const PRIORITY_GUIDE: Record<string, string> = {
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

/**
 * Templates seed the fields a reporter tends to get wrong — category and priority — and
 * leave the two they must write themselves empty. The category is matched against the live
 * domain list by pattern, because those labels are per-deployment.
 */
const TEMPLATES = [
  { key: "bug", label: "Report a bug", hint: "Something is broken", icon: Bug,
    match: /bug|incident|problem/i, priority: "high", prefix: "Bug: " },
  { key: "access", label: "Request access", hint: "Permissions, accounts", icon: KeyRound,
    match: /access|identity|account/i, priority: "medium", prefix: "Access request: " },
  { key: "service", label: "Service request", hint: "Hardware, software, setup", icon: Cloud,
    match: /service|request|hardware|software/i, priority: "medium", prefix: "" },
];

/** The shared input shell: one border, one focus ring, the same height everywhere. */
const FIELD =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateTicketDialog({ open, onOpenChange, preset, onCreated, onToast }: Props) {
  const [draft, setDraft] = useState({ ...EMPTY });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([
    { key: "general", label: "General" },
  ]);
  const [assignable, setAssignable] = useState<{ username: string; group?: string | null }[]>([]);
  const [assigneeScope, setAssigneeScope] = useState<"category" | "all">("all");
  const [jiraReady, setJiraReady] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  /* A domain key from the chat ("network") has to become the dropdown's label ("Network"),
     and the dropdown only exists once the domain list has loaded — so remember the request
     and apply it when the options arrive. */
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  /** Set once the reporter has tried to submit: from then on the missing fields are visible. */
  const [tried, setTried] = useState(false);
  const [dragging, setDragging] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reference data is loaded once per mount; the dialog is mounted with the page.
  useEffect(() => {
    listTicketDestinations()
      .then((ds) => setJiraReady(Boolean(ds.find((d) => d.key === "jira")?.configured)))
      .catch(() => setJiraReady(null));
    listActiveDomains()
      .then((ds) => {
        if (!ds.length) return;
        const hasGeneral = ds.some((x) => x.key === "general");
        const list = ds.map((x) => ({ key: x.key, label: x.label }));
        setCategories(hasGeneral ? list : [{ key: "general", label: "General" }, ...list]);
      })
      .catch(() => {});
  }, []);

  // The category decides the pool: choosing "Network" must offer the network team, not the
  // whole directory. Falls back to every assignable user when the category has no mapping.
  useEffect(() => {
    let alive = true;
    setDraft((d) => ({ ...d, assignee: "" }));
    ticketAssignees(draft.category.toLowerCase())
      .then((d) => {
        if (!alive) return;
        setAssignable(d.assignees ?? []);
        setAssigneeScope(d.configured ? "category" : "all");
        setDraft((prev) => ({ ...prev, assignee: prev.assignee || d.default || "" }));
      })
      .catch(() => { if (alive) setAssignable([]); });
    return () => { alive = false; };
  }, [draft.category, open]);

  // Each opening starts from the preset, not from the previous attempt's leftovers.
  useEffect(() => {
    if (!open) return;
    setDraft({
      ...EMPTY,
      ...(preset?.subject ? { subject: preset.subject.slice(0, MAX_SUBJECT) } : {}),
      ...(preset?.description ? { description: preset.description } : {}),
    });
    setTried(false);
    setPendingDomain(preset?.domain ? preset.domain.toLowerCase() : null);
    setPendingFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The answer's routing domain picks the category as soon as the options are known.
  useEffect(() => {
    if (!open || !pendingDomain) return;
    const match = categories.find(
      (c) => c.key.toLowerCase() === pendingDomain || c.label.toLowerCase() === pendingDomain,
    );
    if (!match) return;
    setDraft((d) =>
      d.category === EMPTY.category || d.category.toLowerCase() === pendingDomain
        ? { ...d, category: match.label }
        : d,
    );
    setPendingDomain(null);
  }, [open, pendingDomain, categories]);

  const missingSubject = tried && !draft.subject.trim();
  const missingDescription = tried && !draft.description.trim();

  async function submit() {
    setTried(true);
    if (!draft.subject.trim()) {
      onToast?.("Ticket subject is required", "err");
      subjectRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const created = await createTicketApi({
        subject: draft.subject.trim(),
        description: draft.description,
        domain: draft.category.toLowerCase(),
        priority: draft.priority,
        assignee: draft.assignee || null,
        due_date: draft.due_date || null,
        destination: "jira",
        session_id: preset?.sessionId || undefined,
      });
      for (const f of pendingFiles) {
        try {
          await ticketAttachmentAdd(created.id, f);
        } catch {
          onToast?.(`Attachment failed: ${f.name}`, "err");
        }
      }
      onOpenChange(false);
      setDraft({ ...EMPTY });
      setPendingFiles([]);
      onToast?.("Ticket created in Jira");
      onCreated?.(created);
    } catch (err: any) {
      onToast?.(err?.message || "Ticket creation failed", "err");
    } finally {
      setCreating(false);
    }
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    const target = categories.find((c) => t.match.test(c.label) || t.match.test(c.key));
    setDraft((d) => ({
      ...d,
      category: target ? target.label : d.category,
      priority: t.priority,
      // A prefix, not a sentence: the reporter still writes the subject.
      subject: d.subject.trim() ? d.subject : t.prefix,
    }));
    requestAnimationFrame(() => subjectRef.current?.focus());
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setPendingFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86dvh] w-[94vw] max-w-[min(1120px,94vw)] gap-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-2xl sm:max-w-[min(1120px,94vw)]">
        {/* ---- header: what this is, and where it lands ---- */}
        <div className="flex items-start gap-3 px-6 pb-4 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 text-white shadow-lg shadow-violet-950/30">
            <TicketIcon className="size-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-bold leading-tight tracking-tight text-foreground">
              Create ticket
            </DialogTitle>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Submit a request to your support team
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  jiraReady === false
                    ? "border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]"
                    : "border-[var(--border)] bg-[var(--muted)]/40 text-muted-foreground",
                ].join(" ")}
              >
                <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3" />
                {jiraReady === false ? "Jira not connected" : "Connected to Jira"}
              </span>
            </div>

            {jiraReady === false && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-[var(--danger)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Jira is not configured yet — set it up in Settings → Integrations first.
              </p>
            )}
          </div>
        </div>

        <div className="max-h-[min(54vh,520px)] space-y-4 overflow-y-auto px-6 pb-5">
          {/* ---- quick templates ---- */}
          <div>
            <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Quick templates
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  data-template={t.key}
                  onClick={() => applyTemplate(t)}
                  title={t.hint}
                  className="rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-xs font-medium text-foreground transition hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10 hover:text-foreground"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* ---- subject ---- */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="ticket-subject" className="text-xs font-medium text-foreground">
                Subject <span className="text-[var(--danger)]">*</span>
              </label>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {draft.subject.length} / {MAX_SUBJECT}
              </span>
            </div>
            <input
              id="ticket-subject"
              ref={subjectRef}
              value={draft.subject}
              maxLength={MAX_SUBJECT}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Briefly describe the issue…"
              aria-label="Subject"
              aria-invalid={missingSubject || undefined}
              className={[
                FIELD,
                missingSubject
                  ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15"
                  : "",
              ].join(" ")}
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
              <label htmlFor="ticket-description" className="text-xs font-medium text-foreground">
                Description <span className="text-[var(--danger)]">*</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {draft.description.length} / {MAX_DESCRIPTION}
                </span>
                <button
                  type="button"
                  /* Improve, not generate: the reporter's own words go in and a clearer version
                     of them comes back. It only needs their description — a subject can come later. */
                  disabled={drafting || !draft.description.trim()}
                  title="Rewrite what you typed as a clearer ticket description"
                  onClick={async () => {
                    setDrafting(true);
                    try {
                      const improved = await improveTicketDescription(draft.description, draft.subject);
                      if (improved) {
                        setDraft((d) => ({ ...d, description: improved }));
                        onToast?.("Description improved");
                      } else {
                        onToast?.("Nothing came back — try again", "err");
                      }
                    } catch (e: any) {
                      onToast?.(e?.message || "Could not improve the description", "err");
                    } finally {
                      setDrafting(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)] transition hover:bg-[var(--primary)]/20 disabled:opacity-40"
                >
                  <Sparkles className="size-3" />
                  {drafting ? "Improving…" : "Improve with AI"}
                </button>
              </div>
            </div>
            <textarea
              id="ticket-description"
              rows={4}
              value={draft.description}
              maxLength={MAX_DESCRIPTION}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What happened, any error messages, the affected system, and what you already tried…"
              aria-label="Ticket description"
              aria-invalid={missingDescription || undefined}
              className={[
                "w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15",
                missingDescription
                  ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15"
                  : "",
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
              <span className="mb-1.5 block text-xs font-medium text-foreground">
                Category <span className="text-[var(--danger)]">*</span>
              </span>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                aria-label="Category"
                className={FIELD}
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.label}>{c.label}</option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-foreground">
                <span>Priority</span>
                <span className="flex items-center gap-1.5 text-[10px] font-normal capitalize text-muted-foreground">
                  <span className={["size-1.5 rounded-full", PRIORITY_DOT[draft.priority] ?? PRIORITY_DOT.medium].join(" ")} />
                  {draft.priority}
                </span>
              </div>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                aria-label="Priority"
                className={FIELD}
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
                {PRIORITY_GUIDE[draft.priority] ?? PRIORITY_GUIDE.medium}
              </span>
            </div>
          </div>

          {/* ---- assignee + due date ---- */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-foreground">Assignee</span>
              <select
                value={draft.assignee}
                onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
                aria-label="Assignee"
                className={FIELD}
              >
                <option value="">Unassigned</option>
                {Object.entries(
                  assignable.reduce<Record<string, typeof assignable>>((acc, u) => {
                    const g = u.group || (assigneeScope === "category" ? "Category team" : "Everyone");
                    (acc[g] ??= []).push(u);
                    return acc;
                  }, {}),
                ).map(([group, users]) => (
                  <optgroup key={group} label={group}>
                    {users.map((u) => (
                      <option key={u.username} value={u.username}>{u.username}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="mt-1 block text-[10px] leading-snug text-muted-foreground">
                {assigneeScope === "category"
                  ? `Only people mapped to ${draft.category} can be picked.`
                  : "No team is mapped to this category yet — showing every assignable user."}
              </span>
            </label>

            <div>
              <label htmlFor="ticket-due-date" className="mb-1.5 block text-xs font-medium text-foreground">
                Due date
              </label>
              <div className="relative">
                <input
                  id="ticket-due-date"
                  type="date"
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  aria-label="Due date"
                  className={[
                    FIELD,
                    "pr-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
                    draft.due_date ? "" : "[&::-webkit-datetime-edit]:text-transparent",
                  ].join(" ")}
                />
                {!draft.due_date && (
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                    Select date
                  </span>
                )}
                <CalendarDays
                  className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </div>
          </div>

          {/* ---- attachments ---- */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">
                Attachments
                <span className="ml-1.5 font-normal text-muted-foreground">(optional · max 10 MB each)</span>
              </span>
              {pendingFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingFiles([])}
                  className="text-[10px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition",
                dragging
                  ? "border-[var(--primary)] bg-[var(--primary)]/10"
                  : "border-[var(--border)] bg-transparent hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/25",
              ].join(" ")}
            >
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Drop files here or{" "}
                <span className="font-semibold text-foreground underline underline-offset-2">browse</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                aria-label="Attachments"
                className="hidden"
              />
            </div>

            {pendingFiles.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {pendingFiles.map((f) => (
                  <li
                    key={`${f.name}:${f.size}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingFiles((prev) => prev.filter((x) => x !== f));
                      }}
                      className="shrink-0 rounded-md p-0.5 text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            className="rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={submit}
            disabled={creating}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-800 px-4 text-xs font-semibold text-white shadow-lg shadow-violet-950/25 transition hover:from-violet-500 hover:to-violet-700 active:scale-[0.99] disabled:opacity-60"
          >
            <Send className="size-3.5" aria-hidden />
            {creating ? "Creating…" : "Create ticket"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateTicketDialog;