/**
 * Ticket detail — the right-hand pane of the Tickets board.
 *
 * Everything that edits a ticket lives here, and every editable field has exactly one
 * destination: Jira. The panel states that once, in a Jira strip at the top, instead of
 * repeating "syncs to Jira" on each control — a queue that mirrors a tracker needs the
 * binding stated once and then left alone.
 *
 * The panel is presentational + local form state only: status transitions, comments and
 * attachments are callbacks so the page keeps one owner for network + optimistic updates.
 */
import { useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  MessageSquare,
  Paperclip,
  Pencil,
  Send,
  Tag,
  Ticket as TicketIcon,
  UserRound,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MetaRow, PriorityBadge, StatusBadge } from "@/features/tickets/components/presentational";
import { attachmentUrl } from "@/features/tickets/api";
import {
  type Assignable,
  type Attachment,
  type Comment,
  type Ticket,
  priorityMeta,
  relTime,
  statusMeta,
} from "@/features/tickets/model";

const FLOW = ["open", "pending", "resolved", "closed"] as const;

type EditFields = { subject: string; description: string; assignee: string; due_date: string };

export function TicketDetailPanel({
  ticket,
  canManage,
  comments,
  attachments,
  assignable,
  statusBusy,
  jiraReady,
  onClose,
  onStatus,
  onSaveEdit,
  onAddComment,
  onAddAttachment,
}: {
  ticket: Ticket | null;
  canManage: boolean;
  comments: Comment[];
  attachments: Attachment[];
  assignable: Assignable[];
  statusBusy: string | null;
  jiraReady: boolean;
  onClose: () => void;
  onStatus: (status: Ticket["status"]) => void;
  onSaveEdit: (fields: EditFields) => Promise<boolean>;
  onAddComment: (body: string) => void;
  onAddAttachment: (file: File) => void;
}) {
  const [editing, setEditing] = useState<EditFields | null>(null);
  const [comment, setComment] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const shell =
    "flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card";

  if (!ticket) {
    return (
      <aside className={`${shell} sticky top-6 hidden max-h-[calc(100vh-6rem)] xl:flex`}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-16 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-[var(--accent-soft)]">
            <TicketIcon className="size-5 text-[var(--accent-foreground)]" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">No ticket selected</h3>
          <p className="max-w-[230px] text-xs leading-5 text-muted-foreground">
            Pick a row to read the request, change its status in Jira, or reply to the
            requester.
          </p>
        </div>
      </aside>
    );
  }

  const status = statusMeta(ticket.status);
  const priority = priorityMeta(ticket.priority);
  // Position in the Jira workflow drives the rail's fill; an unknown status simply sits at
  // the start rather than throwing in the middle of a render.
  const statusIndex = Math.max(0, FLOW.indexOf(ticket.status as (typeof FLOW)[number]));

  async function save() {
    if (!editing) return;
    setSavingEdit(true);
    const ok = await onSaveEdit(editing);
    setSavingEdit(false);
    if (ok) setEditing(null);
  }

  function startEdit() {
    setEditing({
      subject: ticket!.subject,
      description: ticket!.description ?? "",
      assignee: ticket!.assignee ?? "",
      due_date: ticket!.due_date ? ticket!.due_date.slice(0, 10) : "",
    });
  }

  return (
    <aside
      className={`${shell} fixed inset-x-0 bottom-0 z-50 max-h-[88svh] rounded-b-none
        xl:sticky xl:inset-auto xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:rounded-2xl`}
      aria-label="Ticket detail"
    >
      {/* header: identity + Jira binding, stated once */}
      <header className="shrink-0 border-b border-[var(--border)] px-5 pb-4 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tracking-wide text-[var(--accent-foreground)]">
                {ticket.id}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-foreground)]">
                <ExternalLink className="size-2.5" />
                Jira
              </span>
            </div>
            <h2 className="mt-1.5 text-[15px] font-semibold leading-6 text-foreground">
              {ticket.subject}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close ticket detail"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <PriorityBadge priority={priority} suffix=" priority" />
          <span className="ml-auto text-[11px] text-muted-foreground">
            updated {relTime(ticket.updated_at)}
          </span>
        </div>

        <p className="mt-2.5 text-[11px] leading-4 text-muted-foreground">
          Status changes and edits are written to this Jira issue — Jira stays the source of
          truth.
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* status transitions — drawn as the Jira workflow, so the ticket's position in the
            flow is a shape, not a word. The rail fills to the current step; clicking a later
            step animates the move and, if Jira rejects it, snaps back. */}
        {canManage && (
          <div className="mb-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Workflow className="size-3" />
                Jira workflow
              </p>
              <span className="text-[9.5px] text-muted-foreground">
                {jiraReady ? "click a step to move it" : "read-only until Jira is connected"}
              </span>
            </div>

            <div className="relative pb-1">
              {/* One track behind the four steps: it starts at the first node's centre and
                  ends at the last, so the fill percentage matches node spacing exactly. */}
              <div className="absolute left-[12.5%] right-[12.5%] top-[13px] h-[3px]" aria-hidden>
                <div className="h-full rounded-full bg-[var(--border)]" />
                <div
                  data-testid="workflow-fill"
                  data-progress={statusIndex}
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--primary)] to-[var(--accent-foreground)] transition-[width] duration-700 ease-out"
                  style={{ width: `${(statusIndex / (FLOW.length - 1)) * 100}%` }}
                />
              </div>

              <div className="relative flex items-start">
                {FLOW.map((s, i) => {
                  const m = statusMeta(s);
                  const active = ticket.status === s;
                  const done = i < statusIndex;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={!jiraReady || !!statusBusy || active}
                      onClick={() => onStatus(s)}
                      aria-pressed={active}
                      aria-label={`${m.label} — moves the ticket in Jira`}
                      className="group flex w-1/4 flex-col items-center gap-1.5 disabled:cursor-default"
                    >
                      <span className="relative grid size-7 place-items-center">
                        {active && (
                          <>
                            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--primary)]/25" aria-hidden />
                            <span className="absolute inset-0 rounded-full bg-[var(--primary)]/10" aria-hidden />
                          </>
                        )}
                        <span
                          className={[
                            "relative grid size-[19px] place-items-center rounded-full border-2 bg-card transition-all duration-500",
                            active
                              ? "scale-110 border-[var(--primary)]"
                              : done
                                ? "border-[var(--primary)]/70"
                                : "border-[var(--border)] group-hover:border-[var(--primary)]/50",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "size-[7px] rounded-full transition-all duration-500",
                              active ? "bg-[var(--primary)]" : done ? "bg-[var(--primary)]/70" : "bg-[var(--border)]",
                            ].join(" ")}
                          />
                        </span>
                      </span>
                      <span
                        className={[
                          "text-center text-[9.5px] font-semibold leading-tight transition-colors",
                          active ? "text-[var(--accent-foreground)]" : done ? "text-foreground/80" : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
              {!jiraReady
                ? "Jira is not connected, so this workflow is read-only — a local status change would not reach the tracker. Add the base URL, email and API token in Settings → Integrations."
                : statusBusy
                  ? "Asking Jira to accept the transition…"
                  : `Ticket is ${statusMeta(ticket.status).label.toLowerCase()} in the queue — the rail shows how far it has moved.`}
            </p>
          </div>
        )}

        {/* edit form, inline — no modal on top of a panel */}
        {editing ? (
          <div className="mb-5 space-y-3 rounded-xl border border-[var(--border)] bg-muted/20 p-3.5">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Subject
              </span>
              <input
                value={editing.subject}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2.5 text-xs outline-none focus:border-[var(--primary)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description
              </span>
              <textarea
                rows={5}
                value={editing.description}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                className="w-full resize-none rounded-lg border border-[var(--border)] bg-background px-2.5 py-2 text-xs leading-5 outline-none focus:border-[var(--primary)]"
              />
            </label>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Assignee
                </span>
                <select
                  value={editing.assignee}
                  onChange={(e) => setEditing({ ...editing, assignee: e.target.value })}
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none"
                >
                  <option value="">Unassigned</option>
                  {assignable.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Due date
                </span>
                <input
                  type="date"
                  value={editing.due_date}
                  onChange={(e) => setEditing({ ...editing, due_date: e.target.value })}
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="rounded-lg text-xs" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" className="rounded-lg text-xs" disabled={savingEdit} onClick={save}>
                {savingEdit ? "Saving…" : "Save to Jira"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </p>
            <div className="mb-5 whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-muted/20 px-3.5 py-3 text-[13px] leading-6 text-foreground">
              {ticket.description?.trim() || "No description provided."}
            </div>
          </>
        )}

        <div className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
          <MetaRow icon={<UserRound className="size-3" />} label="Requester" value={ticket.requester} />
          <MetaRow icon={<Users className="size-3" />} label="Assignee" value={ticket.assignee ?? "Unassigned"} />
          <MetaRow icon={<Tag className="size-3" />} label="Category" value={ticket.category} />
          <MetaRow icon={<CheckCircle2 className="size-3" />} label="Priority" value={priority.label} />
          <MetaRow icon={<CalendarClock className="size-3" />} label="Created" value={new Date(ticket.created_at).toLocaleString()} />
          <MetaRow
            icon={<CalendarClock className="size-3" />}
            label="Due"
            value={ticket.due_date ? new Date(ticket.due_date).toLocaleDateString() : "—"}
          />
        </div>

        {/* activity */}
        <div className="mb-5">
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Activity
          </p>
          <ol className="relative space-y-3 border-l border-[var(--border)] pl-4">
            <li className="relative">
              <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-[var(--primary)]" aria-hidden />
              <p className="text-[11.5px] font-medium text-foreground">Ticket created</p>
              <p className="text-[11px] text-muted-foreground">
                opened by {ticket.requester} · {relTime(ticket.created_at)}
              </p>
            </li>
            {comments.map((c) => (
              <li key={c.id} className="relative">
                <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-[var(--border)]" aria-hidden />
                <p className="text-[11.5px] font-medium text-foreground">
                  {c.kind === "comment" ? `${c.author ?? "user"} commented` : `Updated by ${c.author ?? "user"}`}
                </p>
                <p className="whitespace-pre-wrap text-[11.5px] leading-5 text-muted-foreground">{c.body}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/70">{relTime(c.created_at ?? "")}</p>
              </li>
            ))}
          </ol>
        </div>

        {/* attachments */}
        {attachments.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Attachments
            </p>
            <div className="space-y-1.5">
              {attachments.map((a) => (
                <a
                  key={a.id}
                  href={attachmentUrl(ticket.id, a.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] transition hover:bg-muted"
                >
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                  <span className="shrink-0 text-muted-foreground">{Math.round(a.size / 1024)} KB</span>
                </a>
              ))}
            </div>
          </div>
        )}

        <label className="mb-5 flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:border-[var(--primary)]/40 hover:text-foreground">
          <Paperclip className="size-3.5" />
          Attach a file
          <input
            type="file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onAddAttachment(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* composer pinned to the bottom of the pane */}
      <footer className="shrink-0 border-t border-[var(--border)] bg-card px-4 py-3">
        <div className="rounded-xl border border-[var(--border)] bg-background focus-within:border-[var(--primary)] focus-within:ring-2 focus-within:ring-[var(--primary)]/10">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && comment.trim()) {
                onAddComment(comment.trim());
                setComment("");
              }
            }}
            rows={2}
            placeholder="Reply to the requester…"
            aria-label="Add a comment"
            className="w-full resize-none bg-transparent px-3 pt-2.5 text-xs leading-5 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-[10px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
            <div className="flex items-center gap-1.5">
              {canManage && (
                <Button variant="outline" size="sm" className="rounded-lg text-[11px]" onClick={startEdit}>
                  <Pencil className="mr-1 size-3" />
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                className="rounded-lg text-[11px]"
                disabled={!comment.trim()}
                onClick={() => {
                  onAddComment(comment.trim());
                  setComment("");
                }}
              >
                <Send className="mr-1 size-3" />
                Send
              </Button>
            </div>
          </div>
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
          <MessageSquare className="size-2.5" />
          Comments are mirrored to the Jira issue.
        </p>
      </footer>
    </aside>
  );
}
