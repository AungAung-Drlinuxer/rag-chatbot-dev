import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Lock,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Ticket as TicketIcon,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { attachmentUrl, downloadAttachment } from "@/features/tickets/api";
import type { TicketEditPayload } from "@/features/tickets/components/TicketDetailPanel";
import {
  PRIORITY_META,
  STATUS_META,
  type Assignable,
  type Attachment,
  type Comment,
  type Ticket,
} from "@/features/tickets/model";

/* ------------------------------------------------------------------
   The workflow states this dialog can move a ticket to, in Jira order.
------------------------------------------------------------------ */
const STATUS_KEYS: Ticket["status"][] = ["open", "pending", "in_progress", "done", "reopened"];

const QUICK_TAGS = [
  "Investigation under way",
  "Waiting for requester response",
  "Fix deployed to staging",
  "Verified in production",
];

const FIELD =
  "h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15";

const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--background)] pl-9 pr-9 text-sm text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15";

function formatDate(value: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket | null;
  comments: Comment[];
  attachments: Attachment[];
  assignable: Assignable[];
  jiraReady: boolean;
  onSave: (payload: TicketEditPayload) => Promise<boolean>;
  onStatus: (status: Ticket["status"], comment: string, internal?: boolean) => Promise<boolean>;
  onAddAttachment: (file: File) => void;
  onDeleteAttachment: (id: number) => void;
  /** Post a note to the issue from the Activity tab's composer. */
  onAddComment?: (body: string, internal: boolean) => void | Promise<void>;
  onToast?: (msg: string, tone?: "ok" | "err") => void;
};

export function EditTicketDialog({
  open,
  onOpenChange,
  ticket,
  comments,
  attachments,
  assignable,
  jiraReady,
  onSave,
  onStatus,
  onAddAttachment,
  onDeleteAttachment,
  onAddComment,
  onToast,
}: Props) {
  // Details
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Ticket["priority"]>("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<Ticket["status"]>("open");

  // Activity
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"details" | "activity">("details");
  const [composer, setComposer] = useState<"reply" | "internal">("internal");
  const [filter, setFilter] = useState<"all" | "comments" | "changes" | "attachments">("all");
  const [addingNote, setAddingNote] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  // Attachments
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Load the opened ticket into the form — once per ticket, not on every refresh of the same
  // row: a save replaces `selected`, and reloading then would throw away what the operator
  // had typed (including a status they had just picked).
  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!ticket) return;
    if (loadedId.current === ticket.id) return;
    loadedId.current = ticket.id;
    setSubject(ticket.subject || "");
    setDescription(ticket.description || "");
    setPriority(ticket.priority || "medium");
    setAssignee(ticket.assignee || "");
    setDueDate(ticket.due_date ? ticket.due_date.slice(0, 10) : "");
    setStatus(ticket.status || "open");
    setNote("");
    setTried(false);
    setTab("details");
  }, [ticket]);

  // Closing forgets the ticket so the next open reads it again.
  useEffect(() => {
    if (!open) loadedId.current = null;
  }, [open]);

  // Every opening starts on Details; stale state is why a save reported the wrong tab.
  useEffect(() => {
    if (!open) return;
    setTab("details");
    setTried(false);
    setNote("");
  }, [open]);

  if (!ticket) return null;

  const statusMetaOf = (s: Ticket["status"]) => STATUS_META[s] ?? STATUS_META.open;
  const priorityMetaOf = (p: Ticket["priority"]) => PRIORITY_META[p] ?? PRIORITY_META.medium;

  const missingSubject = tried && !subject.trim();
  const missingDescription = tried && !description.trim();

/* ---------------------------------------------------------------- activity
     One timeline out of three sources: the comment log (which carries status
     changes too), the attachments, and the creation event. Newest first. */
  type Entry = {
    key: string;
    kind: "comment" | "note" | "change" | "attachment" | "created";
    author: string;
    at: string | null;
    text: string;
    body?: string;
    file?: { name: string; size: number; url: string };
  };

  const entries: Entry[] = [
    ...comments.map((c): Entry => {
      const k = (c.kind || "comment").toLowerCase();
      if (k === "status" || k === "change" || k === "transition") {
        return { key: `c${c.id}`, kind: "change", author: c.author || "System", at: c.created_at ?? null, text: c.body };
      }
      if (k === "note" || k === "internal") {
        return { key: `c${c.id}`, kind: "note", author: c.author || "System", at: c.created_at ?? null, text: "Internal note", body: c.body };
      }
      return { key: `c${c.id}`, kind: "comment", author: c.author || "System", at: c.created_at ?? null, text: "Commented", body: c.body };
    }),
    ...attachments.map((a): Entry => ({
      key: `a${a.id}`,
      kind: "attachment",
      author: a.created_by || "System",
      at: null,
      text: "Added an attachment",
      file: { name: a.filename, size: a.size, url: attachmentUrl(ticket.id, a.id) },
    })),
    {
      key: "created",
      kind: "created" as const,
      author: ticket.requester || "Requester",
      at: ticket.created_at,
      text: "Created this ticket",
    },
  ].sort((a, b) => {
    const av = a.at ? new Date(a.at).getTime() : 0;
    const bv = b.at ? new Date(b.at).getTime() : 0;
    return bv - av;
  });

  const visibleEntries = entries.filter((e) =>
    filter === "all"
      ? true
      : filter === "comments"
        ? e.kind === "comment" || e.kind === "note"
        : filter === "changes"
          ? e.kind === "change" || e.kind === "created"
          : e.kind === "attachment",
  );

  function dayLabel(iso: string | null) {
    if (!iso) return "Earlier";
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }

  function timeLabel(iso: string | null) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function fileKind(name: string) {
    const ext = name.includes(".") ? name.split(".").pop()! : "file";
    return ext.toUpperCase();
  }

  async function postNote() {
    const body = note.trim();
    if (!body || !onAddComment) return;
    setAddingNote(true);
    try {
      await onAddComment(body, composer === "internal");
      setNote("");
      onToast?.("Note added to the issue");
    } catch (err: any) {
      onToast?.(err?.message || "Could not add the note", "err");
    } finally {
      setAddingNote(false);
    }
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function handleQuickTag(tag: string) {
    setNote((prev) => (prev ? `${prev.trim()} · ${tag}` : tag).slice(0, 280));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onAddAttachment(file);
      e.target.value = "";
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onAddAttachment(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!subject.trim()) {
      setTab("details");
      onToast?.("A subject is required", "err");
      return;
    }
    setSaving(true);
    /* Capture the intent before the save: onSave refreshes the selected ticket, which
       re-runs the loader effect and would otherwise reset `status` back to what Jira already
       had — the transition then looked like "no change" and was silently skipped. */
    const originalStatus = ticket!.status;
    const targetStatus = status;
    const transitionNote = note.trim();
    try {
      const ok = await onSave({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        assignee,
        due_date: dueDate,
      });

      if (targetStatus !== originalStatus || transitionNote.length > 0) {
        await onStatus(targetStatus, transitionNote, composer === "internal");
      }

      if (ok) {
        onToast?.("Ticket saved and synced to Jira");
        onOpenChange(false);
      }
    } catch (err: any) {
      onToast?.(err?.message || "Failed to update ticket", "err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86dvh] w-[94vw] max-w-[min(960px,94vw)] gap-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-2xl sm:max-w-[min(960px,94vw)]">
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* ---- header ---- */}
          <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4 pr-14">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-violet-800 text-white shadow-lg shadow-violet-950/30">
              <TicketIcon className="size-4" aria-hidden />
            </span>

            <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base font-bold tracking-tight text-foreground">
              Edit ticket
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-sm font-semibold">{ticket.id}</span>
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                  jiraReady
                    ? "border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok)]"
                    : "border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]",
                ].join(" ")}
              >
                <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3" />
                <span className={["size-1.5 rounded-full", jiraReady ? "bg-[var(--ok)]" : "bg-[var(--warn)]"].join(" ")} />
                {jiraReady ? "Jira synced" : "Jira offline"}
              </span>
            </DialogTitle>
          </div>

          {/* ---- tabs ---- */}
          <div className="flex items-center gap-6 border-b border-[var(--border)] px-6">
            {([
              { key: "details", label: "Details", icon: FileText },
              { key: "activity", label: "Activity", icon: MessageSquare },
            ] as const).map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={[
                    "relative -mb-px inline-flex items-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold transition",
                    active
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="size-3.5" aria-hidden />
                  {t.label}
                  {t.key === "activity" && comments.length > 0 && (
                    <span className="rounded-full bg-[var(--muted)] px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      {comments.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* ---- body ---- */}
          <div className="max-h-[min(54vh,520px)] overflow-y-auto px-6 py-5">
            {tab === "details" ? (
              <div className="space-y-4">
                {/* status */}
                <div>
                  <label htmlFor="ticket-status" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Status
                  </label>
                  <div className="relative">
                    <span
                      className={["pointer-events-none absolute left-3 top-1/2 size-2 -translate-y-1/2 rounded-full", statusMetaOf(status).dot].join(" ")}
                      aria-hidden
                    />
                    <select
                      id="ticket-status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as Ticket["status"])}
                      aria-label="Status"
                      className={SELECT}
                    >
                      {STATUS_KEYS.map((s) => (
                        <option key={s} value={s}>{statusMetaOf(s).label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-2.5" />
                    Pushed to the Jira issue when you save.
                  </p>
                </div>

                {/* subject */}
                <div>
                  <label htmlFor="ticket-subject" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Subject <span className="text-[var(--danger)]">*</span>
                  </label>
                  <input
                    id="ticket-subject"
                    value={subject}
                    maxLength={200}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of the issue"
                    aria-invalid={missingSubject || undefined}
                    className={[FIELD, missingSubject ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15" : ""].join(" ")}
                  />
                  {missingSubject && (
                    <p className="mt-1 text-2xs text-[var(--danger)]">A subject is required.</p>
                  )}
                </div>

                {/* description */}
                <div>
                  <label htmlFor="ticket-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Description <span className="text-[var(--danger)]">*</span>
                  </label>
                  <textarea
                    id="ticket-description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What happened, error messages, and what was already tried…"
                    aria-invalid={missingDescription || undefined}
                    className={[
                      "w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm leading-6 text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15",
                      missingDescription ? "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15" : "",
                    ].join(" ")}
                  />
                </div>

                {/* category + priority */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ticket-category" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Category
                    </label>
                    <div className="relative">
                      <select
                        id="ticket-category"
                        value={ticket.category || "General"}
                        disabled
                        aria-label="Category"
                        className={[SELECT, "cursor-default pl-3 opacity-80"].join(" ")}
                      >
                        <option value={ticket.category || "General"}>{ticket.category || "General"}</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="ticket-priority" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Priority
                    </label>
                    <div className="relative">
                      <AlertTriangle
                        className={["pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2", priorityMetaOf(priority).className].join(" ")}
                        aria-hidden
                      />
                      <select
                        id="ticket-priority"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Ticket["priority"])}
                        aria-label="Priority"
                        className={SELECT}
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>
                </div>

                {/* assignee + due date */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="ticket-assignee" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Assignee
                    </label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full bg-[var(--muted)] text-[10px] font-semibold uppercase text-muted-foreground ring-1 ring-[var(--border)]"
                        aria-hidden
                      >
                        {(assignee || "?").slice(0, 1)}
                      </span>
                      <select
                        id="ticket-assignee"
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                        aria-label="Assignee"
                        className={SELECT}
                      >
                        <option value="">Unassigned</option>
                        {assignable.map((a) => (
                          <option key={a.username} value={a.username}>
                            {a.username}{a.group ? ` · ${a.group}` : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="ticket-due-date" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Due date
                    </label>
                    <div className="relative">
                      <input
                        id="ticket-due-date"
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        aria-label="Due date"
                        className={[
                          FIELD,
                          "pl-9 pr-9 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-9 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0",
                          dueDate ? "[&::-webkit-datetime-edit]:text-transparent" : "",
                        ].join(" ")}
                      />
                      {dueDate ? (
                        <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-sm text-foreground">
                          {formatDate(dueDate)}
                        </span>
                      ) : (
                        <span className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-sm text-muted-foreground/60">
                          Select date
                        </span>
                      )}
                      <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>
                </div>

                {/* attachments */}
                <div>
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Attachments
                    <span className="ml-1.5 font-normal">(optional · max 10 MB each)</span>
                  </span>

                  {attachments.length > 0 && (
                    <ul className="mb-2 flex flex-wrap gap-2">
                      {attachments.map((a) => (
                        <li
                          key={a.id}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 py-1 pl-2 pr-1"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <a
                            href={attachmentUrl(ticket.id, a.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate text-xs text-foreground hover:underline"
                          >
                            {a.filename}
                          </a>
                          <button
                            type="button"
                            onClick={() => onDeleteAttachment(a.id)}
                            aria-label={`Remove ${a.filename}`}
                            className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-[var(--muted)] hover:text-[var(--danger)]"
                          >
                            <X className="size-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={[
                      "flex cursor-pointer items-center gap-2 rounded-lg border border-dashed px-4 py-4 transition",
                      dragActive
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-[var(--border)] bg-transparent hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/25",
                    ].join(" ")}
                  >
                    <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <p className="text-xs text-muted-foreground">
                      Drop files here or{" "}
                      <span className="font-semibold text-foreground underline underline-offset-2">browse</span>
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                {/* --- timeline (left) --- */}
                <div className="lg:col-span-8">
                  {/* ticket brief */}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3.5">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Ticket brief
                    </span>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={["inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium", statusMetaOf(status).className].join(" ")}>
                        <span className={["size-1.5 rounded-full", statusMetaOf(status).dot].join(" ")} aria-hidden />
                        {statusMetaOf(status).label}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="grid size-5 place-items-center rounded-full bg-[var(--muted)] text-[10px] font-semibold uppercase text-muted-foreground ring-1 ring-[var(--border)]" aria-hidden>
                          {(assignee || "?")[0]}
                        </span>
                        {assignee || "Unassigned"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-semibold leading-snug text-foreground">{ticket.subject}</p>
                  </div>

                  {/* timeline header + filters */}
                  <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Activity timeline
                      </span>
                      <h3 className="text-sm font-semibold text-foreground">Activity</h3>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { key: "all", label: "All" },
                        { key: "comments", label: "Comments" },
                        { key: "changes", label: "Changes" },
                        { key: "attachments", label: "Attachments" },
                      ] as const).map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => setFilter(f.key)}
                          aria-pressed={filter === f.key}
                          className={[
                            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition",
                            filter === f.key
                              ? "border-transparent bg-[var(--primary)] text-white"
                              : "border-[var(--border)] text-muted-foreground hover:border-[var(--primary)]/40 hover:text-foreground",
                          ].join(" ")}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {visibleEntries.length === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-muted-foreground">
                      Nothing in this filter yet.
                    </p>
                  ) : (
                    <ul className="mt-2">
                      {visibleEntries.map((e, i) => {
                        const prev = visibleEntries[i - 1];
                        const showDay = !!e.at && (!prev || dayLabel(prev.at) !== dayLabel(e.at));
                        return (
                          <li key={e.key}>
                            {showDay && (
                              <p className="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                {dayLabel(e.at)}
                              </p>
                            )}

                            <div className="flex gap-3">
                              <div className="flex flex-col items-center">
                                {e.kind === "created" ? (
                                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--muted)] text-muted-foreground ring-1 ring-[var(--border)]">
                                    <UserRound className="size-3.5" aria-hidden />
                                  </span>
                                ) : (
                                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--primary)]/15 text-[11px] font-semibold uppercase text-[var(--accent-foreground)] ring-1 ring-[var(--primary)]/25">
                                    {(e.author || "?")[0]}
                                  </span>
                                )}
                                {i < visibleEntries.length - 1 && (
                                  <span className="mt-1 w-px flex-1 bg-[var(--border)]" aria-hidden />
                                )}
                              </div>

                              <div className="min-w-0 flex-1 pb-4">
                                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <span className="text-xs font-semibold text-foreground">{e.author}</span>
                                  <span className="text-[10px] text-muted-foreground">{timeLabel(e.at)}</span>
                                </div>

                                {e.kind === "note" ? (
                                  <>
                                    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                                      <Lock className="size-3" aria-hidden /> Internal note
                                    </span>
                                    <div className="mt-1 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-xs leading-5 text-foreground">
                                      {e.body}
                                    </div>
                                  </>
                                ) : e.kind === "attachment" && e.file ? (
                                  <>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{e.text}</p>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        ticket &&
                                        downloadAttachment(ticket.id, Number(e.key.slice(1)), e.file!.name).catch(
                                          () => onToast?.("Could not download the attachment", "err"),
                                        )
                                      }
                                      className="mt-1 flex w-full max-w-sm items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-left transition hover:border-[var(--primary)]/40"
                                    >
                                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-xs font-medium text-foreground">{e.file.name}</span>
                                        <span className="block text-[10px] text-muted-foreground">
                                          {fileKind(e.file.name)} · {formatBytes(e.file.size)}
                                        </span>
                                      </span>
                                      <Download className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <p className="mt-0.5 text-xs text-muted-foreground">{e.text}</p>
                                    {e.body && <p className="mt-0.5 text-xs leading-5 text-foreground">{e.body}</p>}
                                    {e.kind === "created" && (
                                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                                        Category: {ticket.category || "General"} · Priority: {priorityMetaOf(ticket.priority).label}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* --- composer (right) --- */}
                <div className="lg:col-span-4">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Note composer
                    </span>

                    <div className="mt-2 flex gap-4 border-b border-[var(--border)]">
                      {([
                        { key: "reply", label: "Reply" },
                        { key: "internal", label: "Internal note" },
                      ] as const).map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() => setComposer(c.key)}
                          aria-selected={composer === c.key}
                          role="tab"
                          className={[
                            "relative -mb-px border-b-2 pb-2 text-[11px] font-semibold transition",
                            composer === c.key
                              ? "border-[var(--primary)] text-[var(--primary)]"
                              : "border-transparent text-muted-foreground hover:text-foreground",
                          ].join(" ")}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {QUICK_TAGS.map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => handleQuickTag(tag)}
                          className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-foreground"
                        >
                          + {tag}
                        </button>
                      ))}
                    </div>

                    <textarea
                      rows={5}
                      value={note}
                      maxLength={280}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={composer === "internal" ? "Add an internal note..." : "Write a reply to the requester..."}
                      aria-label="Activity note"
                      className="mt-2 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                    />

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <Paperclip className="size-3" aria-hidden />
                        <Lock className="size-3" aria-hidden />
                        {composer === "internal"
                          ? "Internal note — agents only, never shown to the requester"
                          : "Public reply — visible to the requester on the Jira issue"}
                      </span>
                      <button
                        type="button"
                        onClick={postNote}
                        disabled={addingNote || !note.trim() || !onAddComment}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-[11px] font-semibold text-white transition hover:bg-[var(--primary)]/90 disabled:opacity-50"
                      >
                        {addingNote ? "Adding…" : "Add note"}
                      </button>
                    </div>
                    <p className="mt-1 text-right font-mono text-[10px] text-muted-foreground">{note.length}/280</p>
                  </div>
                </div>
              </div>
            )}          </div>

          {/* ---- footer ---- */}
          <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
            <Button type="button" variant="ghost" className="rounded-lg" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-violet-800 px-4 text-xs font-semibold text-white shadow-lg shadow-violet-950/25 transition hover:from-violet-500 hover:to-violet-700 active:scale-[0.99] disabled:opacity-60"
            >
              {saving ? (
                <RefreshCw className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-3.5" aria-hidden />
              )}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EditTicketDialog;