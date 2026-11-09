/**
 * Escalate to IT Support — the reviewed ticket form.
 *
 * Two steps, deliberately: opening the dialog asks the backend for a *draft*; nothing is
 * created until "Confirm & Create". The textarea holds the exact body that will be sent,
 * so an edit made here is what Jira receives — the server never regenerates it.
 *
 * A failed submit keeps the form and its edits on screen, with the retry key unchanged so
 * a second click cannot open a second ticket.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, ShieldCheck, Ticket as TicketIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  createEscalationDraft, getEscalationFields, submitEscalation,
  type EscalationDraft, type EscalationFields,
} from "@/features/escalation/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  onCreated?: (ticket: { jira_key: string; link: string }) => void;
  onToast?: (message: string, tone?: "ok" | "err") => void;
};

const FIELD = "w-full rounded-lg border border-[var(--border)] bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20";

export function EscalateDialog({ open, onOpenChange, sessionId, onCreated, onToast }: Props) {
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<EscalationDraft | null>(null);
  const [meta, setMeta] = useState<EscalationFields | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [project, setProject] = useState("");
  const [issueType, setIssueType] = useState("");
  const [priority, setPriority] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<{ jira_key: string; link: string; duplicate?: boolean } | null>(null);

  /* One key per opened draft: every retry of this form reuses it, so the second click
     after a timeout is answered with the ticket instead of creating another. */
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const reset = useCallback(() => {
    setDraft(null); setMeta(null); setLoadError(null); setErrors([]);
    setResult(null); setSummary(""); setDescription(""); setProject("");
    setIssueType(""); setPriority(""); setSubmitting(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!sessionId) {
      setLoadError("Open a conversation first — there is nothing to escalate yet.");
      return;
    }
    let cancelled = false;
    reset();
    setIdempotencyKey(crypto.randomUUID());
    setLoading(true);

    (async () => {
      try {
        const [fields, made] = await Promise.all([
          getEscalationFields().catch(() => null),
          createEscalationDraft(sessionId),
        ]);
        if (cancelled) return;
        setMeta(fields);
        setDraft(made);
        setSummary(made.summary ?? "");
        setDescription(made.description ?? "");
        setProject(made.project || fields?.default_project || "");
        setIssueType(made.issue_type || fields?.default_issue_type || "");
        setPriority(made.priority ?? "");
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, sessionId, reset]);

  const issueTypes = useMemo(() => meta?.issue_types ?? [], [meta]);
  const priorities = meta?.priorities ?? [];
  const kbLinks = draft?.kb_links ?? [];
  const missing = draft?.missing_info ?? [];
  const requiredCustom = useMemo(() => {
    const group = (meta?.required_fields ?? []).find(
      (g) => (g.issue_type ?? "").toLowerCase() === issueType.toLowerCase(),
    );
    return group?.fields ?? [];
  }, [meta, issueType]);

  async function submit() {
    if (!draft || submitting) return;
    setSubmitting(true);
    setErrors([]);
    try {
      const res = await submitEscalation({
        draft_id: draft.draft_id,
        base_hash: draft.content_hash,
        summary: summary.trim(),
        description,
        project,
        issue_type: issueType,
        priority,
        custom_fields: draft.custom_fields ?? {},
        idempotency_key: idempotencyKey,
      });
      setResult(res);
      onCreated?.({ jira_key: res.jira_key, link: res.link });
      onToast?.(`Ticket ${res.jira_key} created`, "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The backend returns every validation problem in one sentence list; keep them
      // visible next to the fields instead of a toast that disappears.
      setErrors(message.split(/\s{2,}|(?<=\.)\s(?=[A-Z])/).filter(Boolean));
      onToast?.("Ticket was not created — the draft is still here to fix.", "err");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) onOpenChange(v); }}>
      <DialogContent className="max-h-[92vh] w-[min(880px,94vw)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="size-4" /> Escalate to IT Support
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading the conversation and drafting the ticket…
          </div>
        )}

        {!loading && loadError && (
          <div className="space-y-3 py-6">
            <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {loadError}
            </p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        )}

        {!loading && !loadError && result && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <p className="font-semibold">
                {result.duplicate ? "Already created" : "Ticket created"} — {result.jira_key}
              </p>
              {result.link && (
                <a href={result.link} target="_blank" rel="noopener noreferrer"
                   className="mt-1 inline-flex items-center gap-1 underline">
                  Open {result.jira_key} in Jira <ExternalLink className="size-3" />
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              The ticket key is also posted in this conversation.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}

        {!loading && !loadError && !result && draft && (
          <div className="space-y-4 py-2">
            <p className="flex items-start gap-2 rounded-lg bg-[var(--muted)] px-3 py-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
              Drafted from this conversation, with secrets and personal data removed. Nothing is
              created until you confirm. Edit anything that is wrong — empty is better than invented.
            </p>

            {draft.source === "fallback" && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                The assistant could not summarise this conversation, so the draft quotes your own
                messages. Please tighten the summary and description below.
              </p>
            )}

            {missing.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                <p className="font-semibold">Still needed — the draft will not invent these:</p>
                <ul className="mt-1 list-disc pl-5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}

            <label className="block text-xs font-medium text-muted-foreground">
              Summary
              <input
                aria-label="Ticket summary"
                className={`${FIELD} mt-1`}
                maxLength={120}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
              <span className="mt-1 block text-right text-[10px] text-muted-foreground">
                {summary.length}/120
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-muted-foreground">
                Project
                <select aria-label="Project" className={`${FIELD} mt-1`} value={project}
                        onChange={(e) => setProject(e.target.value)}>
                  {!meta?.projects?.length && project && <option value={project}>{project}</option>}
                  {(meta?.projects ?? []).map((p) => (
                    <option key={p.key} value={p.key}>{p.key}{p.name ? ` — ${p.name}` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Issue type
                <select aria-label="Issue type" className={`${FIELD} mt-1`} value={issueType}
                        onChange={(e) => setIssueType(e.target.value)}>
                  {issueTypes.map((t) => (
                    <option key={t.id || t.name} value={t.name}>{t.name}</option>
                  ))}
                  {!issueTypes.length && issueType && <option value={issueType}>{issueType}</option>}
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">
                Priority
                <select aria-label="Priority" className={`${FIELD} mt-1`} value={priority}
                        onChange={(e) => setPriority(e.target.value)}>
                  <option value="">Not specified</option>
                  {priorities.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
            </div>

            {requiredCustom.length > 0 && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                Jira also requires: {requiredCustom.map((f) => f.name).join(", ")}. Fill these in Jira
                after the ticket is created, or ask an admin to add them to this form.
              </p>
            )}

            <label className="block text-xs font-medium text-muted-foreground">
              Description
              <textarea
                aria-label="Ticket description"
                className={`${FIELD} mt-1 min-h-[220px] font-mono text-[12.5px] leading-relaxed`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>

            {kbLinks.length > 0 && (
              <div className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs">
                <p className="font-medium text-muted-foreground">Related knowledge base</p>
                <ul className="mt-1 space-y-0.5">
                  {kbLinks.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-[var(--primary)] underline">
                        {l.title || l.url} <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {errors.length > 0 && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <p className="font-semibold">Not created yet:</p>
                <ul className="mt-1 list-disc pl-5">
                  {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}

            <DialogFooter className="gap-2">
              <span className="mr-auto text-[11px] text-muted-foreground">
                {meta?.configured === false
                  ? "Jira is not configured — the ticket cannot be created until an admin adds credentials."
                  : "Creates a real Jira ticket when you confirm."}
              </span>
              <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={submitting || !summary.trim() || !description.trim()} onClick={() => void submit()}>
                {submitting ? <><Loader2 className="mr-1.5 size-4 animate-spin" /> Creating…</> : "Confirm & Create"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
