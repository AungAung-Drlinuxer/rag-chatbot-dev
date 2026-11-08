/**
 * Edit a ticket — one dialog, one save, one trip to Jira.
 *
 * The old edit form only covered four fields, sat inside the read pane, and uploaded
 * attachments separately, so "done editing" could mean three different requests had landed in
 * three different orders. Here everything the operator can change is staged in one form:
 * details, attachments (add and remove), and the workflow step with its note. Nothing is
 * written until Save, and Save reports exactly which half Jira refused.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Paperclip, Trash2, Upload, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_META, type Assignable, type Attachment, type Ticket } from "@/features/tickets/model";

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

export type TicketEditPayload = {
  subject: string;
  description: string;
  priority: string;
  assignee: string;
  due_date: string;
  /** `null` means "leave the workflow alone". */
  status: string | null;
  comment: string;
  addFiles: File[];
  removeAttachments: number[];
};

function fileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function TicketEditDialog({
  ticket,
  assignable,
  attachments,
  jiraReady,
  busy,
  onClose,
  onSave,
}: {
  ticket: Ticket | null;
  assignable: Assignable[];
  attachments: Attachment[];
  jiraReady: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: TicketEditPayload) => Promise<boolean>;
}) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string>("");
  const [comment, setComment] = useState("");
  const [addFiles, setAddFiles] = useState<File[]>([]);
  const [removeIds, setRemoveIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticket) return;
    setSubject(ticket.subject ?? "");
    setDescription(ticket.description ?? "");
    setPriority(ticket.priority ?? "medium");
    setAssignee(ticket.assignee ?? "");
    setDueDate(ticket.due_date ? ticket.due_date.slice(0, 10) : "");
    setStatus("");
    setComment("");
    setAddFiles([]);
    setRemoveIds([]);
    setError(null);
  }, [ticket]);

  const kept = useMemo(
    () => attachments.filter((a) => !removeIds.includes(a.id)),
    [attachments, removeIds],
  );

  const dirty =
    addFiles.length > 0 ||
    removeIds.length > 0 ||
    Boolean(status) ||
    comment.trim().length > 0 ||
    (ticket
      ? subject !== (ticket.subject ?? "") ||
        description !== (ticket.description ?? "") ||
        priority !== (ticket.priority ?? "medium") ||
        assignee !== (ticket.assignee ?? "") ||
        dueDate !== (ticket.due_date ? ticket.due_date.slice(0, 10) : "")
      : false);

  async function save() {
    setError(null);
    if (!subject.trim()) {
      setError("A ticket needs a subject.");
      return;
    }
    const ok = await onSave({
      subject: subject.trim(),
      description,
      priority,
      assignee,
      due_date: dueDate,
      status: status || null,
      comment: comment.trim(),
      addFiles,
      removeAttachments: removeIds,
    });
    if (!ok) setError("Save failed — see the notice above for Jira's reason. Nothing was lost.");
  }

  const field =
    "h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2.5 text-xs outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10";
  const label = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground";

  return (
    <Dialog open={Boolean(ticket)} onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-2xl rounded-2xl p-0">
        <DialogHeader className="border-b border-[var(--border)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <span className="font-mono text-[11px] text-[var(--accent-foreground)]">{ticket?.id}</span>
            Edit ticket
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {jiraReady
              ? "Details, attachments and the workflow step are written to this Jira issue on save."
              : "Jira is not connected — changes are stored here only and cannot reach the tracker."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-3">
            <label className="block">
              <span className={label}>Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                aria-label="Subject"
                className={field}
              />
            </label>

            <label className="block">
              <span className={label}>Description</span>
              <textarea
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-label="Description"
                placeholder="What is wrong, what has been tried, what the requester needs."
                className="w-full resize-y rounded-lg border border-[var(--border)] bg-background px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/10"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className={label}>Priority</span>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  aria-label="Priority"
                  className={field}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Assignee</span>
                <select
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  aria-label="Assignee"
                  className={field}
                >
                  <option value="">Unassigned</option>
                  {assignable.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username}
                      {u.group ? ` · ${u.group}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Due date</span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date"
                  className={field}
                />
              </label>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className={label}>Attachments</span>
              <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-[var(--primary)]/40 hover:text-foreground">
                <Upload className="size-3" aria-hidden />
                Add files
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  aria-label="Add attachments"
                  onChange={(e) => {
                    const picked = Array.from(e.target.files ?? []);
                    if (picked.length) setAddFiles((prev) => [...prev, ...picked]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>

            {kept.length === 0 && addFiles.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11px] text-muted-foreground">
                No attachments. Files are uploaded to the issue when you save.
              </p>
            ) : (
              <ul className="space-y-1">
                {kept.map((a) => (
                  <li
                    key={`kept-${a.id}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px]"
                  >
                    <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                    <span className="shrink-0 text-muted-foreground">{fileSize(a.size)}</span>
                    <button
                      type="button"
                      onClick={() => setRemoveIds((prev) => [...prev, a.id])}
                      aria-label={`Remove ${a.filename}`}
                      className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-[var(--danger)]"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}

                {addFiles.map((f, i) => (
                  <li
                    key={`new-${f.name}-${i}`}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--primary)]/40 bg-[var(--accent-soft)]/40 px-2.5 py-1.5 text-[11px]"
                  >
                    <Paperclip className="size-3 shrink-0 text-[var(--accent-foreground)]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-[var(--accent-foreground)]">
                      {fileSize(f.size)} · on save
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`Drop ${f.name}`}
                      className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-[var(--danger)]"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {removeIds.length > 0 && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {removeIds.length} attachment{removeIds.length === 1 ? "" : "s"} will be deleted
                from Jira when you save.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-muted/20 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Workflow className="size-3" aria-hidden /> Workflow
            </p>
            <div className="grid gap-2.5 sm:grid-cols-[180px_1fr]">
              <label className="block">
                <span className="sr-only">Move to status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  aria-label="Move to status"
                  className={field}
                >
                  <option value="">Keep {ticket ? STATUS_META[ticket.status].label : "current"}</option>
                  {Object.entries(STATUS_META).map(([key, meta]) => (
                    <option key={key} value={key} disabled={ticket?.status === key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Note for Jira</span>
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label="Note for Jira"
                  placeholder="Optional note — posted to the issue with this save."
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-background px-2.5 py-2 text-[11px] leading-5 outline-none focus:border-[var(--primary)]"
                />
              </label>
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Jira only accepts moves its workflow allows. A refusal stops the save and leaves
              the ticket where it was.
            </p>
          </section>

          {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
        </div>

        <DialogFooter className="border-t border-[var(--border)] px-5 py-3">
          <span className="mr-auto text-[10px] text-muted-foreground">
            {dirty ? "Unsaved changes" : "Nothing changed yet"}
          </span>
          <Button variant="outline" size="sm" className="rounded-lg text-xs" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" className="rounded-lg text-xs" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? <Loader2 className="mr-1 size-3 animate-spin" aria-hidden /> : null}
            {busy ? "Saving…" : "Save ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
