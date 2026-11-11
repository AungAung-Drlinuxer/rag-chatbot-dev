/**
 * Escalation approval queue (human in the loop).
 *
 * The chat pipeline already pauses inside the LangGraph and writes an `approvals` row when an
 * answer needs a human decision; what was missing was a place to decide. The notification bell
 * linked here, and here there was nothing — so a pending escalation could only wait forever,
 * or be bypassed by creating the ticket straight from the answer.
 *
 * Approving resumes the graph, which creates the Jira issue itself; rejecting resumes it with
 * a refusal. This component never calls the ticket API, so a decision can never produce two
 * tickets.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, ShieldQuestion, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { decideApproval, listApprovals } from "@/features/chat/api";

type Approval = {
  id: string;
  username: string | null;
  question: string | null;
  status: string;
  created_at: string | null;
};

export function ApprovalQueue({
  onToast,
  onDecided,
}: {
  onToast?: (message: string, tone?: "ok" | "err") => void;
  onDecided?: () => void;
}) {
  const [rows, setRows] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listApprovals()
      .then((d) => {
        setRows((d?.approvals ?? []) as Approval[]);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = rows.filter((r) => r.status === "pending");

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id);
    try {
      const res = await decideApproval(id, decision);
      // The graph reports back what actually happened; a rejection has no ticket.
      onToast?.(
        decision === "approved"
          ? res?.ticket_id
            ? `Approved — ticket ${res.ticket_id} created`
            : "Approved — ticket creation started"
          : "Rejected — no ticket was created",
      );
      load();
      onDecided?.();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : "Decision failed", "err");
    } finally {
      setBusy(null);
    }
  }

  if (error && pending.length === 0) return null;
  if (pending.length === 0) return null;

  return (
    <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--warn)]/40 bg-card">
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--warn)]/8 px-4 py-2.5">
        <ShieldQuestion className="size-3.5 text-[var(--warn)]" />
        <h2 className="text-xs font-semibold">
          Awaiting your decision
          <span className="ml-1.5 font-normal text-muted-foreground">{pending.length} pending</span>
        </h2>
      </header>
      <ul className="divide-y divide-[var(--border)]">
        {pending.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-2xs">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium" title={a.question ?? ""}>{a.question || "Escalation approval requested"}</p>
              <p className="mt-0.5 text-muted-foreground">
                {a.username || "unknown user"}
                {a.created_at ? ` · ${new Date(a.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 px-2 text-2xs" disabled={busy === a.id} onClick={() => decide(a.id, "rejected")}>
                <X className="mr-1 size-3" /> Reject
              </Button>
              <Button size="sm" className="h-7 px-2 text-2xs" disabled={busy === a.id} onClick={() => decide(a.id, "approved")}>
                {busy === a.id ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Check className="mr-1 size-3" />}
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ApprovalQueue;
