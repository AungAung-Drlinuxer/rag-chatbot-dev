import { useEffect, useState } from "react";
import { Sparkles, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import type { TicketDraft } from "@/features/chat/model";
import {
  TicketFormFields,
  SUBJECT_MAX,
  EMPTY_TICKET_FORM,
  type TicketFormValues,
} from "@/features/tickets/components/TicketForm";
import {
  improveTicketDescription,
  ticketAssignees,
  type CategoryAssignee,
} from "@/features/tickets/api";

/** Edit the draft before it becomes an issue. It draws the shared ticket form — the same
 *  fields, in the same order, as Create ticket and Edit ticket — because a draft is just a
 *  pre-filled create: anything the reporter could change there, they can change here. */
export default function ChatTicketDialog({
  open,
  draft,
  domains,
  busy,
  onOpenChange,
  onSave,
  onCreate,
  onToast,
}: {
  open: boolean;
  draft: TicketDraft | null;
  domains: { key: string; label: string }[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: TicketDraft) => void;
  onCreate: (next: TicketDraft) => void;
  onToast?: (message: string, tone?: "ok" | "err") => void;
}) {
  const [form, setForm] = useState<TicketFormValues>(EMPTY_TICKET_FORM);
  const [assignable, setAssignable] = useState<CategoryAssignee[]>([]);
  const [assigneeScope, setAssigneeScope] = useState<"category" | "all">("all");
  const [improving, setImproving] = useState(false);

  /** Category is stored as a label (what the API takes); the draft carries a domain key. */
  const labelFor = (key: string) =>
    domains.find((d) => d.key.toLowerCase() === key?.toLowerCase())?.label ?? key ?? "";

  // Each opening starts from the draft, not from the previous attempt's leftovers.
  useEffect(() => {
    if (!open || !draft) return;
    setForm({
      ...EMPTY_TICKET_FORM,
      subject: draft.subject ?? "",
      description: draft.description ?? "",
      category: labelFor(draft.domain),
      priority: draft.priority ?? "medium",
      assignee: draft.assignee ?? "",
      due_date: draft.due_date ?? "",
      components: (draft.components ?? []).join(", "),
      labels: (draft.labels ?? []).join(", "),
      original_estimate: draft.original_estimate ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  // Same pool rule as Create ticket: the category decides who can own it.
  useEffect(() => {
    let alive = true;
    if (!open || !form.category) {
      setAssignable([]);
      return;
    }
    ticketAssignees(form.category.toLowerCase())
      .then((d) => {
        if (!alive) return;
        setAssignable(d.assignees ?? []);
        setAssigneeScope(d.configured ? "category" : "all");
      })
      .catch(() => { if (alive) setAssignable([]); });
    return () => { alive = false; };
  }, [open, form.category]);

  if (!draft) return null;

  const valid = form.subject.trim().length > 0;

  const toDraft = (): TicketDraft => ({
    subject: form.subject.trim(),
    description: form.description,
    priority: form.priority as TicketDraft["priority"],
    domain: domains.find((d) => d.label === form.category)?.key ?? draft.domain,
    assignee: form.assignee || null,
    due_date: form.due_date || null,
    components: form.components.split(",").map((v) => v.trim()).filter(Boolean),
    labels: form.labels.split(",").map((v) => v.trim()).filter(Boolean),
    original_estimate: form.original_estimate.trim() || null,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="editor">
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-6 pb-4 pr-14 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand-grad-from)] to-[var(--brand-grad-to)] text-white shadow-lg shadow-black/25">
            <Ticket className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-bold leading-tight tracking-tight text-foreground">
              Review ticket
            </DialogTitle>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3" />
              Created in Jira · drafted from this answer
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--primary)]">
                <Sparkles className="size-3" /> AI extracted
              </span>
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <TicketFormFields
            values={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            categories={domains.map((d) => ({ key: d.key, label: d.label }))}
            assignable={assignable}
            assigneeScope={assigneeScope}
            onImprove={async () => {
              setImproving(true);
              try {
                const improved = await improveTicketDescription(form.description, form.subject);
                if (improved) {
                  setForm((f) => ({ ...f, description: improved }));
                  onToast?.("Description improved");
                } else {
                  onToast?.("Nothing came back — try again", "err");
                }
              } catch (e: any) {
                onToast?.(e?.message || "Could not improve the description", "err");
              } finally {
                setImproving(false);
              }
            }}
            improving={improving}
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Subject limit {SUBJECT_MAX} characters — Jira rejects anything longer.
          </p>
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--border)] px-6 py-3">
          <Button variant="ghost" className="rounded-lg" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            className="rounded-lg"
            onClick={() => {
              onSave(toDraft());
              onOpenChange(false);
            }}
            disabled={!valid}
          >
            Save draft
          </Button>
          <button
            type="button"
            onClick={() => onCreate(toDraft())}
            disabled={!valid || busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[var(--brand-grad-from)] to-[var(--brand-grad-to)] px-4 text-xs font-semibold text-white shadow-lg shadow-black/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
          >
            <Ticket className="size-3.5" aria-hidden />
            {busy ? "Creating…" : "Create ticket"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
