import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  RefreshCw,
  Tag,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { attachmentUrl } from "@/features/tickets/api";
import type { TicketEditPayload } from "@/features/tickets/components/TicketDetailPanel";
import {
  PRIORITY_META,
  relTime,
  type Assignable,
  type Attachment,
  type Comment,
  type Ticket,
} from "@/features/tickets/model";

/* ------------------------------------------------------------------
   Interactive Workflow Step Definitions
------------------------------------------------------------------ */
const STEPS = [
  {
    key: "open",
    step: "Step 1/4",
    title: "Open",
    desc: "Backup item created",
  },
  {
    key: "pending",
    step: "Step 2/4",
    title: "Pending",
    desc: "Awaiting triage / info",
  },
  {
    key: "in_progress",
    step: "Step 3/4",
    title: "In progress",
    desc: "Actively being worked on",
  },
  {
    key: "done",
    step: "Final Step",
    title: "Done",
    desc: "Resolved & verified",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const QUICK_TAGS = [
  "Investigation under way",
  "Waiting for requester response",
  "Fix deployed to staging",
  "Verified in production",
];

const PRIORITY_GUIDE: Record<string, string> = {
  critical: "Service is down or blocking all users",
  high: "Significant business impact with no workaround",
  medium: "Normal operational issue or feature request",
  low: "Minor question, cosmetic bug or non-urgent change",
};

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
  // Form fields
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Ticket["priority"]>("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState("General");

  // Workflow state
  const [selectedStep, setSelectedStep] = useState<StepKey>("open");
  const [noteTab, setNoteTab] = useState<"transition" | "internal" | "sync">("transition");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Attachment upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  // Sync state whenever the opened ticket changes
  useEffect(() => {
    if (ticket) {
      setSubject(ticket.subject || "");
      setDescription(ticket.description || "");
      setPriority(ticket.priority || "medium");
      setAssignee(ticket.assignee || "");
      setDueDate(ticket.due_date ? ticket.due_date.slice(0, 10) : "");
      setCategory(ticket.category || "General");

      const initialStatus =
        ticket.status === "reopened" ? "open" : (ticket.status as StepKey);
      setSelectedStep(initialStatus);
      setNote("");
    }
  }, [ticket, open]);

  if (!ticket) return null;

  const currentStepIdx = STEPS.findIndex((s) => s.key === selectedStep);
  const progressPercent = Math.max(15, Math.round(((currentStepIdx + 1) / STEPS.length) * 100));

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
    if (file) {
      onAddAttachment(file);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // 1. Save document details
      const payload: TicketEditPayload = {
        subject: subject.trim() || ticket!.subject,
        description: description.trim(),
        priority,
        assignee,
        due_date: dueDate,
      };

      const docOk = await onSave(payload);

      // 2. If status was changed or a transition note was provided, apply status change
      if (selectedStep !== ticket!.status || note.trim().length > 0) {
        await onStatus(selectedStep, note.trim());
      }

      if (docOk) {
        onToast?.("Interactive Jira workflow synced successfully");
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
      <DialogContent className="w-[95vw] sm:max-w-[95vw] lg:max-w-[1350px] xl:max-w-[1450px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[#191927] p-0 shadow-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Header */}
          <div className="border-b border-[var(--border)] bg-[#11111B] px-6 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--primary)]/15 text-[var(--primary)]">
                  <RefreshCw className="size-4 animate-spin-slow" />
                </span>
                <div>
                  <DialogTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-white">
                    EDIT TICKET
                    <span className="rounded-md border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 font-mono text-xs font-semibold text-[var(--lavender)]">
                      #{ticket.id}
                    </span>
                    <span className="text-2xs font-normal text-muted-foreground">
                      · Jira Workflow
                    </span>
                  </DialogTitle>
                  <p className="text-2xs text-muted-foreground">
                    Select pipeline state to auto-sync status across boards
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold",
                    jiraReady
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                      : "border-amber-500/25 bg-amber-500/10 text-amber-400",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "size-1.5 rounded-full",
                      jiraReady ? "bg-emerald-400 animate-pulse" : "bg-amber-400",
                    ].join(" ")}
                  />
                  {jiraReady ? "Jira Sync Active" : "Jira Offline"}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close dialog"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-600 via-indigo-500 to-purple-400 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Stepper Cards: 4-Column Horizontal Pipeline */}
          <div className="border-b border-[var(--border)] bg-[#11111B]/60 px-6 py-3">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {STEPS.map((s, idx) => {
                const isDone = idx < currentStepIdx;
                const isSelected = s.key === selectedStep;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSelectedStep(s.key)}
                    className={[
                      "flex flex-col justify-between rounded-xl border p-2.5 text-left transition duration-150",
                      isSelected
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 shadow-[0_0_15px_rgba(139,92,246,0.15)] ring-1 ring-[var(--primary)]/40"
                        : isDone
                          ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50"
                          : "border-[var(--border)] bg-[#222236]/60 hover:border-white/20 hover:bg-[#222236]",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {s.step}
                      </span>
                      {isDone ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400" />
                      ) : isSelected ? (
                        <span className="size-2 rounded-full bg-[var(--primary)] ring-4 ring-[var(--primary)]/25" />
                      ) : (
                        <span className="size-2 rounded-full border border-muted-foreground/40" />
                      )}
                    </div>
                    <div className="mt-1.5">
                      <div
                        className={[
                          "text-xs font-bold leading-tight",
                          isSelected ? "text-white" : isDone ? "text-emerald-300" : "text-foreground",
                        ].join(" ")}
                      >
                        {s.title}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground/80">
                        {s.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Balanced 2-Column Rectangular Body (Avoids vertical stacking) */}
          <div className="max-h-[calc(100dvh-17rem)] overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
              {/* Left Column (7 cols): Workflow Notes & Description */}
              <div className="space-y-4 lg:col-span-7">
                {/* Transition Note & Quick Tags Card */}
                <div className="rounded-xl border border-[var(--border)] bg-[#222236]/50 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)]/70 pb-2.5">
                    <div className="flex items-center gap-1 rounded-lg bg-black/20 p-0.5">
                      <button
                        type="button"
                        onClick={() => setNoteTab("transition")}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs font-semibold transition",
                          noteTab === "transition"
                            ? "bg-[var(--primary)] text-white shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        <MessageSquare className="size-3" />
                        Transition Note
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteTab("internal")}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs font-semibold transition",
                          noteTab === "internal"
                            ? "bg-[var(--primary)] text-white shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        Internal Note
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteTab("sync")}
                        className={[
                          "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs font-semibold transition",
                          noteTab === "sync"
                            ? "bg-[var(--primary)] text-white shadow-xs"
                            : "text-muted-foreground hover:text-foreground",
                        ].join(" ")}
                      >
                        <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-2.5" />
                        Sync to Jira
                      </button>
                    </div>
                    <span className="font-mono text-2xs text-muted-foreground">
                      {note.length}/280 chars
                    </span>
                  </div>

                  {/* Quick Tags / Templates */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {QUICK_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => handleQuickTag(tag)}
                        className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:border-[var(--primary)]/40 hover:bg-[var(--primary)]/10 hover:text-white"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>

                  {/* Note Textarea */}
                  <div className="mt-2">
                    <textarea
                      rows={2}
                      value={note}
                      maxLength={280}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add transition note (e.g. Investigation under way, waiting on reporter, etc.)…"
                      className="w-full resize-none rounded-xl border border-[var(--border)] bg-[#11111B] px-3 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                    />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Will be appended to ticket audit trail &amp; Jira issue history.
                    </p>
                  </div>
                </div>

                {/* Subject Field */}
                <div>
                  <label
                    htmlFor="ticket-subject"
                    className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    SUBJECT
                  </label>
                  <input
                    id="ticket-subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of the issue"
                    className="h-9 w-full rounded-xl border border-[var(--border)] bg-[#11111B] px-3 text-xs font-semibold text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                  />
                </div>

                {/* Description Field */}
                <div>
                  <label
                    htmlFor="ticket-description"
                    className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    DESCRIPTION
                  </label>
                  <textarea
                    id="ticket-description"
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What happened, error messages, and what was already tried…"
                    className="w-full resize-none rounded-xl border border-[var(--border)] bg-[#11111B] px-3 py-2 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                  />
                </div>
              </div>

              {/* Right Column (5 cols): Metadata Grid & Activity/Attachments */}
              <div className="space-y-4 lg:col-span-5">
                {/* Metadata Card */}
                <div className="rounded-xl border border-[var(--border)] bg-[#222236]/40 p-3.5">
                  <span className="mb-2.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    TICKET DETAILS
                  </span>
                  <div className="grid grid-cols-2 gap-3">
                    {/* Requester */}
                    <div>
                      <span className="mb-1 block text-[10px] text-muted-foreground">Requester</span>
                      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[#11111B]/80 px-2.5 text-2xs text-foreground">
                        <UserRound className="size-3 text-muted-foreground" />
                        <span className="truncate font-medium">{ticket.requester || "System"}</span>
                      </div>
                    </div>

                    {/* Category */}
                    <div>
                      <span className="mb-1 block text-[10px] text-muted-foreground">Category</span>
                      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[#11111B] px-2.5 text-2xs text-foreground">
                        <Tag className="size-3 text-muted-foreground" />
                        <span className="truncate font-medium">{category}</span>
                      </div>
                    </div>

                    {/* Created Date */}
                    <div>
                      <span className="mb-1 block text-[10px] text-muted-foreground">Created</span>
                      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[#11111B]/80 px-2.5 text-2xs text-foreground">
                        <Clock className="size-3 text-muted-foreground" />
                        <span className="truncate font-mono text-[10px]">
                          {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString() : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Due Date */}
                    <div>
                      <label htmlFor="ticket-due-date" className="mb-1 block text-[10px] text-muted-foreground">
                        Due Date
                      </label>
                      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[#11111B] px-2.5">
                        <CalendarDays className="size-3 text-muted-foreground" />
                        <input
                          id="ticket-due-date"
                          type="date"
                          value={dueDate}
                          onChange={(e) => setDueDate(e.target.value)}
                          className="w-full bg-transparent text-2xs text-foreground outline-none"
                        />
                      </div>
                    </div>

                    {/* Priority */}
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Priority</span>
                        <span className="flex items-center gap-1 text-3xs font-normal capitalize">
                          <span
                            className={[
                              "size-1.5 rounded-full",
                              PRIORITY_META[priority]?.dot || "bg-amber-500",
                            ].join(" ")}
                          />
                          {priority}
                        </span>
                      </div>
                      <select
                        value={priority}
                        onChange={(e) => setPriority(e.target.value as Ticket["priority"])}
                        className="h-8 w-full rounded-lg border border-[var(--border)] bg-[#11111B] px-2 text-2xs text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                      >
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground" title={PRIORITY_GUIDE[priority]}>
                        {PRIORITY_GUIDE[priority]}
                      </p>
                    </div>

                    {/* Assignee */}
                    <div>
                      <label htmlFor="ticket-assignee" className="mb-1 block text-[10px] text-muted-foreground">
                        Assignee
                      </label>
                      <select
                        id="ticket-assignee"
                        value={assignee}
                        onChange={(e) => setAssignee(e.target.value)}
                        className="h-8 w-full rounded-lg border border-[var(--border)] bg-[#11111B] px-2 text-2xs text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                      >
                        <option value="">Unassigned</option>
                        {assignable.map((a) => (
                          <option key={a.username} value={a.username}>
                            {a.username} ({a.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Activity & Attachments Card */}
                <div className="rounded-xl border border-[var(--border)] bg-[#222236]/40 p-3.5 space-y-3">
                  <span className="block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    ACTIVITY &amp; ATTACHMENTS
                  </span>

                  {/* Recent Activity Log */}
                  {comments.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[#11111B]/60 p-2.5">
                      {comments.slice(-2).map((c) => (
                        <div key={c.id} className="flex items-start gap-1.5 text-2xs">
                          <span className="mt-1 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-foreground">{c.author || "System"}</span>
                            {" · "}
                            <span className="text-muted-foreground">{c.body}</span>
                          </div>
                          <span className="shrink-0 text-3xs text-muted-foreground">
                            {c.created_at ? relTime(c.created_at) : "recently"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Existing Attachments */}
                  {attachments.length > 0 && (
                    <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[#11111B]/60">
                      {attachments.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-2xs">
                          <a
                            href={attachmentUrl(ticket.id, a.id)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-w-0 items-center gap-1.5 text-foreground hover:underline"
                          >
                            <FileText className="size-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{a.filename}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => onDeleteAttachment(a.id)}
                            className="rounded p-1 text-muted-foreground hover:text-[var(--danger)]"
                            title="Remove attachment"
                          >
                            <Trash2 className="size-2.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Attachments Dropzone */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={[
                      "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed p-3 text-center transition",
                      dragActive
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-[var(--border)] bg-[#11111B]/40 hover:border-[var(--primary)]/40 hover:bg-muted/20",
                    ].join(" ")}
                  >
                    <UploadCloud className="size-4.5 text-muted-foreground" />
                    <p className="mt-1 text-2xs font-medium text-foreground">
                      Click or drag files to attach
                    </p>
                    <p className="text-3xs text-muted-foreground">
                      Up to 10 MB per file · Synced to Jira
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <DialogFooter className="flex items-center justify-between border-t border-[var(--border)] bg-[#11111B] px-6 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="rounded-xl h-8 px-3 text-xs"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={saving}
              className="btn-primary-gradient rounded-xl shadow-md text-white h-8 px-3.5 text-xs font-semibold"
            >
              {saving ? (
                <>
                  <RefreshCw className="mr-1.5 size-3 animate-spin" />
                  Saving &amp; Syncing…
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-1.5 size-3" />
                  Save &amp; Sync to Jira
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default EditTicketDialog;
