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
 * The shape of the screen: a header that says what this is, the one thing a reporter has to
 * know (it lands in Jira), four templates that fill the boring half of the form, then the two
 * fields they actually have to write. Everything below that — category, priority, assignee,
 * due date, files — is optional context, so it reads as one row instead of five equal asks.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Bug, CalendarDays, Cloud, Headset, HelpCircle, KeyRound, Paperclip,
  Send, Sparkles, Ticket as TicketIcon, UploadCloud, X, Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
  { key: "service", label: "IT service request", hint: "Hardware, software, setup", icon: Cloud,
    match: /service|request|hardware|software/i, priority: "medium", prefix: "" },
  { key: "question", label: "Ask a question", hint: "How does this work?", icon: HelpCircle,
    match: /general|question|other/i, priority: "low", prefix: "" },
];

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
      <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-2xl p-0">
        {/* ---- header ---- */}
        <div className="flex items-start gap-3.5 border-b border-[var(--border)] px-6 py-5">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-violet-800 text-white shadow-lg shadow-violet-950/30">
            <Headset className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-semibold leading-tight tracking-tight">
              Create support ticket
            </DialogTitle>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Describe your issue and we&rsquo;ll help you as soon as possible.
            </p>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-16rem)] space-y-5 overflow-y-auto px-6 py-5">
          {/* ---- where this goes ---- */}
          <div className="flex items-start gap-2.5 rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/10 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--accent-foreground)]">
            <TicketIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Create in Jira</span>
              <span className="text-[var(--accent-foreground)]/80">
                {" "}— there is no other destination; the issue is mirrored into this queue.
              </span>
              {jiraReady === false && (
                <span className="mt-1 flex items-start gap-1.5 font-medium text-[var(--danger)]">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  Jira is not configured yet — set it up in Settings → Integrations first.
                </span>
              )}
            </span>
          </div>

          {/* ---- templates ---- */}
          <div>
            <div className="mb-2 flex items-center gap-1.5">
              <Zap className="size-3.5 text-[var(--primary)]" aria-hidden />
              <span className="text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Quick templates
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {TEMPLATES.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    type="button"
                    data-template={t.key}
                    onClick={() => applyTemplate(t)}
                    className="group flex flex-col items-start gap-1 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 p-2.5 text-left transition hover:-translate-y-0.5 hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/50"
                  >
                    <Icon className="size-4 text-[var(--primary)]" aria-hidden />
                    <span className="text-xs font-semibold leading-tight">{t.label}</span>
                    <span className="text-[10px] leading-tight text-muted-foreground">{t.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ---- subject ---- */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <label htmlFor="ticket-subject" className="text-xs font-medium">
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
                "h-10 w-full rounded-xl border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:ring-4",
                missingSubject
                  ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/10"
                  : "border-[var(--border)] focus:border-[var(--primary)] focus:ring-[var(--primary)]/10",
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
              <label htmlFor="ticket-description" className="text-xs font-medium">
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--primary)] transition hover:bg-[var(--primary)]/20 disabled:opacity-40"
                >
                  <Sparkles className="size-3" />
                  {drafting ? "Improving…" : "Improve with AI"}
                </button>
              </div>
            </div>
            <textarea
              id="ticket-description"
              rows={5}
              value={draft.description}
              maxLength={MAX_DESCRIPTION}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What happened, any error messages, the affected system, and what you already tried…"
              aria-label="Ticket description"
              aria-invalid={missingDescription || undefined}
              className={[
                "w-full resize-none rounded-xl border bg-background px-3 py-2.5 text-sm leading-6 outline-none transition placeholder:text-muted-foreground/70 focus:ring-4",
                missingDescription
                  ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/10"
                  : "border-[var(--border)] focus:border-[var(--primary)] focus:ring-[var(--primary)]/10",
              ].join(" ")}
            />
            {missingDescription && (
              <p className="mt-1 flex items-center gap-1 text-2xs text-[var(--danger)]">
                <AlertCircle className="size-3" /> Say what happened — IT cannot act on a title alone.
              </p>
            )}
          </div>

          {/* ---- context row ---- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Category</span>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                aria-label="Category"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.label}>{c.label}</option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
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
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                {PRIORITY_GUIDE[draft.priority] ?? PRIORITY_GUIDE.medium}
              </p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Assignee</span>
              <select
                value={draft.assignee}
                onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
                aria-label="Assignee"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
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

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Due date</span>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="date"
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  aria-label="Due date"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-background pr-3 pl-9 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
                />
              </div>
            </label>
          </div>

          {/* ---- attachments ---- */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <Paperclip className="size-3.5 text-muted-foreground" aria-hidden /> Attachments
                <span className="font-normal text-muted-foreground">(optional)</span>
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
                "flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center transition",
                dragging
                  ? "border-[var(--primary)] bg-[var(--primary)]/10"
                  : "border-[var(--border)] bg-[var(--muted)]/20 hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/35",
              ].join(" ")}
            >
              <UploadCloud className="size-5 text-[var(--primary)]" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Drag and drop files here, or{" "}
                <span className="font-semibold text-[var(--primary)]">choose files</span>
              </p>
              <p className="text-[10px] text-muted-foreground/80">
                PNG, JPG, PDF, DOCX · max 10 MB each
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
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-background px-2.5 py-1.5"
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

        <DialogFooter className="gap-2 border-t border-[var(--border)] px-6 py-4">
          <span className="mr-auto hidden text-[10px] text-muted-foreground sm:block">
            Files are attached after the ticket exists in Jira.
          </span>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <button
            type="button"
            onClick={submit}
            disabled={creating}
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-violet-800 px-4 text-xs font-semibold text-white shadow-lg shadow-violet-950/30 transition hover:from-violet-500 hover:to-violet-700 active:scale-[0.99] disabled:opacity-60"
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
