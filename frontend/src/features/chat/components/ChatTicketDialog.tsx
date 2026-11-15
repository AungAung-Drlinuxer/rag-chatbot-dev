import { useEffect, useState } from "react";
import { Sparkles, Ticket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import type { TicketDraft } from "@/features/chat/model";

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

const FIELD =
  "h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 text-xs text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20";
const LABEL = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

/** Edit the draft before it becomes an issue. Same fields as the create API — offering
 *  Controls the ticket cannot carry would be a form that lies. */
export default function ChatTicketDialog({
  open,
  draft,
  domains,
  busy,
  onOpenChange,
  onSave,
  onCreate,
}: {
  open: boolean;
  draft: TicketDraft | null;
  domains: { key: string; label: string }[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: TicketDraft) => void;
  onCreate: (next: TicketDraft) => void;
}) {
  const [form, setForm] = useState<TicketDraft | null>(draft);

  useEffect(() => {
    if (open) setForm(draft);
  }, [open, draft]);

  if (!form) return null;

  const set = <K extends keyof TicketDraft>(key: K, value: TicketDraft[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const valid = form.subject.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="form">
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

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-6 py-5">
          <div>
            <label className={LABEL} htmlFor="draft-subject">
              Summary <span className="text-[var(--danger)]">*</span>
            </label>
            <input
              id="draft-subject"
              value={form.subject}
              onChange={(e) => set("subject", e.target.value)}
              maxLength={110}
              className={FIELD}
              placeholder="One line naming the problem"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{form.subject.length}/110 characters</p>
          </div>

          <div>
            <label className={LABEL} htmlFor="draft-description">
              Description
            </label>
            <textarea
              id="draft-description"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={10}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-xs leading-relaxed text-foreground outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
              placeholder="What is happening, the impact, what was tried"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL} htmlFor="draft-components">
                Components
              </label>
              <input
                id="draft-components"
                value={(form.components || []).join(", ")}
                onChange={(e) =>
                  set(
                    "components",
                    e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                  )
                }
                className={FIELD}
                placeholder="Network & VPN, macOS"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">Must already exist in Jira.</p>
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-labels">
                Labels
              </label>
              <input
                id="draft-labels"
                value={(form.labels || []).join(", ")}
                onChange={(e) =>
                  set(
                    "labels",
                    e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                  )
                }
                className={FIELD}
                placeholder="vpn, macos"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-priority">
                Priority
              </label>
              <select
                id="draft-priority"
                value={form.priority}
                onChange={(e) => set("priority", e.target.value as TicketDraft["priority"])}
                className={FIELD}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p} className="capitalize">
                    {p[0].toUpperCase() + p.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-domain">
                Category
              </label>
              <select
                id="draft-domain"
                value={form.domain}
                onChange={(e) => set("domain", e.target.value)}
                className={FIELD}
              >
                {domains.length === 0 && <option value={form.domain}>{form.domain}</option>}
                {domains.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-assignee">
                Assignee
              </label>
              <input
                id="draft-assignee"
                value={form.assignee ?? ""}
                onChange={(e) => set("assignee", e.target.value || null)}
                className={FIELD}
                placeholder="Leave blank to auto-assign"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-estimate">
                Original estimate
              </label>
              <input
                id="draft-estimate"
                value={form.original_estimate ?? ""}
                onChange={(e) => set("original_estimate", e.target.value || null)}
                className={FIELD}
                placeholder="2h · 1d 4h"
              />
            </div>

            <div>
              <label className={LABEL} htmlFor="draft-due">
                Due date
              </label>
              <input
                id="draft-due"
                type="date"
                value={form.due_date ?? ""}
                onChange={(e) => set("due_date", e.target.value || null)}
                className={FIELD}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-[var(--border)] px-6 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onSave({ ...form, subject: form.subject.trim() });
              onOpenChange(false);
            }}
            disabled={!valid}
          >
            Save draft
          </Button>
          <button
            type="button"
            onClick={() => onCreate({ ...form, subject: form.subject.trim() })}
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
