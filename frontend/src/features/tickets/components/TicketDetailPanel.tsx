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
import { useEffect, useState } from "react";
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
  Trash2,
  UserRound,
  Users,
  Workflow,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MetaRow, PriorityBadge, StatusBadge } from "@/features/tickets/components/presentational";
import { attachmentUrl } from "@/features/tickets/api";
import {
  type Attachment,
  type Comment,
  type Ticket,
  priorityMeta,
  relTime,
  statusMeta,
} from "@/features/tickets/model";

// The rail is Jira's happy path. `reopened` is a loop back to the start, not a fifth dot:
// it is shown on the badge and fills the rail at step one.
const FLOW = ["open", "pending", "in_progress", "done"] as const;

export function TicketDetailPanel({
  ticket,
  canManage,
  comments,
  attachments,
  statusBusy,
  jiraReady,
  onClose,
  onStatus,
  onEdit,
  onDeleteAttachment,
  onAddComment,
  onAddAttachment,
}: {
  ticket: Ticket | null;
  canManage: boolean;
  comments: Comment[];
  attachments: Attachment[];
  statusBusy: string | null;
  jiraReady: boolean;
  onClose: () => void;
  onStatus: (status: Ticket["status"], comment: string) => Promise<boolean>;
  /** Opens the edit sheet — every editable field, attachments and the workflow live there. */
  onEdit: () => void;
  onDeleteAttachment: (id: number) => void;
  onAddComment: (body: string) => void;
  onAddAttachment: (file: File) => void;
}) {
  const [comment, setComment] = useState("");
  // Two halves of one action: which step to move to, and what to tell the people in Jira.
  const [target, setTarget] = useState<Ticket["status"] | null>(null);
  const [note, setNote] = useState("");
  const [applying, setApplying] = useState(false);
  /**
   * Nothing is editable until the operator says so.
   *
   * The panel used to carry live inputs — a workflow stepper that fired a Jira transition, a
   * comment composer, an upload label — so a stray click on a row you were only reading could
   * write to Jira. Now the panel is a document; Edit unlocks the controls, Done locks them.
   */
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setEditing(false);
    setTarget(null);
    setNote("");
    setComment("");
  }, [ticket?.id]);

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
  const isReopened = ticket.status === "reopened";
  const statusIndex = isReopened
    ? 0
    : Math.max(0, FLOW.indexOf(ticket.status as (typeof FLOW)[number]));

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

          <div className="flex shrink-0 items-center gap-1.5">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-lg px-2 text-[11px]"
                  onClick={onEdit}
                  title="Subject, description, priority, due date and assignee"
                >
                  <Pencil className="mr-1 size-3" /> Details
                </Button>
                <Button
                  size="sm"
                  className="h-7 rounded-lg px-2 text-[11px]"
                  onClick={() => setEditing(false)}
                >
                  Done
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 rounded-lg px-2 text-[11px]"
                onClick={() => setEditing(true)}
                disabled={!canManage}
                aria-label="Edit ticket"
                title={canManage ? "Unlock comments, workflow and attachments" : "Your role cannot change tickets"}
              >
                <Pencil className="mr-1 size-3" /> Edit
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Close ticket detail"
            >
              <X className="size-4" />
            </button>
          </div>
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
                {!jiraReady
                  ? "read-only until Jira is connected"
                  : editing
                    ? "click a step to move it"
                    : "read-only — Edit to move"}
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
                  const active = ticket.status === s || (isReopened && s === "open");
                  const done = i < statusIndex;
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={!editing || !jiraReady || !!statusBusy || active}
                      onClick={() => setTarget(s)}
                      aria-pressed={target === s || active}
                      aria-label={`${m.label} — selects this step for the next update`}
                      aria-disabled={!editing || !jiraReady || !!statusBusy || active}
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
                          target === s
                            ? "text-[var(--accent-foreground)] underline decoration-dotted underline-offset-2"
                            : active
                              ? "text-[var(--accent-foreground)]"
                              : done
                                ? "text-foreground/80"
                                : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {m.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {!jiraReady ? (
              <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
                Jira is not connected, so this workflow is read-only — a local status change
                would not reach the tracker. Add the base URL, email and API token in
                Settings → Integrations.
              </p>
            ) : !editing ? (
              /* Locked: the rail still shows where the ticket sits, but there is nothing to
                 click and no note box to type into until Edit is pressed. */
              <p className="mt-3 flex items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
                <Pencil className="size-3 shrink-0" />
                Read-only. Press Edit to move this ticket in Jira, or to comment.
              </p>
            ) : (
              /* One action: pick a step, say why, save once. The old rail fired a transition
                 on click, so the comment explaining it had to be sent separately — or never. */
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-muted/20 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  {target ? (
                    <>
                      <span className="text-[10px] text-muted-foreground">Move to</span>
                      <span className="rounded-md bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-foreground)]">
                        {statusMeta(target).label}
                      </span>
                      <button
                        type="button"
                        onClick={() => setTarget(null)}
                        className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                      >
                        clear
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      Pick a step above to move the ticket, or just write a note.
                    </span>
                  )}
                </div>

                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What changed? Posted to Jira with the status…"
                  aria-label="Comment to post with the status change"
                  className="w-full resize-none rounded-lg border border-[var(--border)] bg-background px-2.5 py-2 text-[11.5px] leading-5 outline-none focus:border-[var(--primary)]"
                />

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[9.5px] text-muted-foreground">
                    {statusBusy || applying ? "Saving to Jira…" : "Status and comment are sent together"}
                  </span>
                  <Button
                    size="sm"
                    className="rounded-lg text-[11px]"
                    disabled={(!target && !note.trim()) || !!statusBusy || applying}
                    onClick={async () => {
                      setApplying(true);
                      const ok = await onStatus(target ?? ticket.status, note.trim());
                      setApplying(false);
                      if (ok) {
                        setTarget(null);
                        setNote("");
                      }
                    }}
                  >
                    <Workflow className="mr-1 size-3" />
                    {target ? "Update in Jira" : "Comment only"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Description
        </p>
        <div className="mb-5 whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-muted/20 px-3.5 py-3 text-[13px] leading-6 text-foreground">
          {ticket.description?.trim() || "No description provided."}
        </div>

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
                <div
                  key={a.id}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] pl-2.5 pr-1 text-[11px] transition hover:bg-muted"
                >
                  <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                  <a
                    href={attachmentUrl(ticket.id, a.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 flex-1 items-center gap-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">{a.filename}</span>
                    <span className="shrink-0 text-muted-foreground">{Math.round(a.size / 1024)} KB</span>
                  </a>
                  {editing && canManage && (
                    <button
                      type="button"
                      onClick={() => onDeleteAttachment(a.id)}
                      aria-label={`Delete ${a.filename}`}
                      className="rounded p-1 text-muted-foreground transition hover:bg-card hover:text-[var(--danger)]"
                    >
                      <Trash2 className="size-3" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {editing ? (
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
        ) : (
          <p className="mb-5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Paperclip className="size-3" /> Attachments are read-only — Edit to add or remove files.
          </p>
        )}
      </div>

      {/* Composer is the bottom of the pane — only while the panel is unlocked. */}
      <footer className="shrink-0 border-t border-[var(--border)] bg-card px-4 py-3">
        {editing ? (
          <>
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
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
              <MessageSquare className="size-2.5" />
              Comments are mirrored to the Jira issue.
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[10.5px] leading-4 text-muted-foreground">
              <MessageSquare className="size-3 shrink-0" />
              Read-only. Edit to comment, move the workflow or attach a file.
            </p>
            {canManage && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 rounded-lg text-[11px]"
                onClick={() => setEditing(true)}
                aria-label="Edit ticket"
              >
                <Pencil className="mr-1 size-3" /> Edit
              </Button>
            )}
          </div>
        )}
      </footer>
    </aside>
  );
}
