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
 */
import { useEffect, useState } from "react";
import { Plus, Sparkles, Ticket as TicketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { articleDraft } from "@/features/knowledge/api";
import { createTicketApi, listActiveDomains, listTicketDestinations, ticketAttachmentAdd } from "@/features/tickets/api";
import { assignableUsers } from "@/features/users/api";

export type CreateTicketPreset = {
  subject?: string;
  description?: string;
  sessionId?: string | null;
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

export function CreateTicketDialog({ open, onOpenChange, preset, onCreated, onToast }: Props) {
  const [draft, setDraft] = useState({ ...EMPTY });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([
    { key: "general", label: "General" },
  ]);
  const [assignable, setAssignable] = useState<{ username: string; role?: string }[]>([]);
  const [jiraReady, setJiraReady] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);

  // Reference data is loaded once per mount; the dialog is mounted with the page.
  useEffect(() => {
    assignableUsers()
      .then((d) => setAssignable(d?.users ?? []))
      .catch(() => {});
    listTicketDestinations()
      .then((ds) => setJiraReady(Boolean(ds.find((d) => d.key === "jira")?.configured)))
      .catch(() => setJiraReady(null));
    listActiveDomains()
      .then((ds) => {
        if (!ds.length) return;
        const hasGeneral = ds.some((x) => x.key === "general");
        setCategories([
          ...(hasGeneral ? [{ key: "general", label: "General" }] : []),
          ...ds.map((x) => ({ key: x.key, label: x.label })),
        ]);
      })
      .catch(() => {});
  }, []);

  // Each opening starts from the preset, not from the previous attempt's leftovers.
  useEffect(() => {
    if (!open) return;
    setDraft({ ...EMPTY, ...(preset?.subject ? { subject: preset.subject.slice(0, 200) } : {}), ...(preset?.description ? { description: preset.description } : {}) });
    setPendingFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    if (!draft.subject.trim()) {
      onToast?.("Ticket subject is required", "err");
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl">
        <DialogHeader>
          <DialogTitle>Create support ticket</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)]/50 px-3 py-2 text-[11px] text-[var(--accent-foreground)]">
            <TicketIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Create in Jira</span>
              <span className="text-[var(--accent-foreground)]/80">
                {" "}— there is no other destination; the issue is mirrored into this queue.
              </span>
              {jiraReady === false && (
                <span className="mt-1 block font-medium">
                  Jira is not configured yet — set it up in Settings → Integrations first.
                </span>
              )}
            </span>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Subject</span>
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              placeholder="Briefly describe the issue"
              aria-label="Subject"
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium">Description</span>
              <button
                type="button"
                disabled={drafting || !draft.subject.trim()}
                onClick={async () => {
                  setDrafting(true);
                  try {
                    const data = await articleDraft(draft.subject, draft.category.toLowerCase());
                    if (data.draft) {
                      setDraft((d) => ({ ...d, description: data.draft }));
                      onToast?.("AI draft generated");
                    } else {
                      onToast?.(data.detail || "Draft failed", "err");
                    }
                  } catch {
                    onToast?.("Draft failed", "err");
                  } finally {
                    setDrafting(false);
                  }
                }}
                className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
              >
                <Sparkles className="size-3" />
                {drafting ? "Drafting…" : "AI assist"}
              </button>
            </div>
            <textarea
              rows={5}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="What happened, any error messages, the affected system, and what you already tried…"
              aria-label="Ticket description"
              className="w-full resize-none rounded-xl border border-[var(--border)] bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Category</span>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                aria-label="Category"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
              >
                {categories.map((c) => (
                  <option key={c.key} value={c.label}>{c.label}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Priority</span>
              <select
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
                aria-label="Priority"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Assignee</span>
              <select
                value={draft.assignee}
                onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
                aria-label="Assignee"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
              >
                <option value="">Unassigned</option>
                {assignable.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username}{u.role === "admin" ? " (admin)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Due date</span>
              <input
                type="date"
                value={draft.due_date}
                onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                aria-label="Due date"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
              />
            </label>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium">Attachments</span>
            <input
              type="file"
              multiple
              onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
              className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--accent-foreground)]"
            />
            {pendingFiles.length > 0 && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""} ready — uploaded after the ticket exists.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={creating}>
            <Plus className="mr-2 size-4" />
            {creating ? "Creating…" : "Create ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateTicketDialog;
