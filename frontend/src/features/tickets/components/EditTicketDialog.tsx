import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  FileText,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Ticket as TicketIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { attachmentUrl } from "@/features/tickets/api";
import type { TicketEditPayload } from "@/features/tickets/components/TicketDetailPanel";
import {
  PRIORITY_META,
  STATUS_META,
  relTime,
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
  onStatus: (status: Ticket["status"], comment: string) => Promise<boolean>;
  onAddAttachment: (file: File) => void;
  onDeleteAttachment: (id: number) => void;
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
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);

  // Attachments
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Load the opened ticket into the form.
  useEffect(() => {
    if (!ticket) return;
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
    try {
      const ok = await onSave({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        assignee,
        due_date: dueDate,
      });

      if (status !== ticket!.status || note.trim().length > 0) {
        await onStatus(status, note.trim());
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
      <DialogContent className="w-[95vw] gap-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-0 shadow-2xl sm:max-w-[95vw] lg:max-w-[1350px] xl:max-w-[1450px]">
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
          <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto px-6 py-5">
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
                  <p className="mt-1 text-[10px] text-muted-foreground">
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
              <div className="space-y-4">
                {/* note composer */}
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">Add a note</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{note.length}/280</span>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {QUICK_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleQuickTag(tag)}
                        className="rounded-full border border-[var(--border)] px-2.5 py-0.5 text-[11px] text-muted-foreground transition hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-foreground"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>

                  <textarea
                    rows={2}
                    value={note}
                    maxLength={280}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Why is this moving? The note lands in the Jira issue history."
                    aria-label="Activity note"
                    className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Posted to Jira with the status change when you save.
                  </p>
                </div>

                {/* timeline */}
                <div>
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    History
                  </span>

                  {comments.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-xs text-muted-foreground">
                      Nothing yet — notes and status changes are recorded here.
                    </p>
                  ) : (
                    <ul>
                      {[...comments].reverse().map((c, i) => (
                        <li key={c.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[var(--primary)]" aria-hidden />
                            {i < comments.length - 1 && <span className="w-px flex-1 bg-[var(--border)]" aria-hidden />}
                          </div>
                          <div className="min-w-0 flex-1 pb-4">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="text-xs font-semibold text-foreground">{c.author || "System"}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {c.created_at ? relTime(c.created_at) : "recently"}
                              </span>
                              {c.kind && c.kind !== "comment" && (
                                <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                                  {c.kind}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{c.body}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

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