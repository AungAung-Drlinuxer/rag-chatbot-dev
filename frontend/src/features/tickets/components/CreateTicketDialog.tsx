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
 *
 * The shape of the screen follows one column, top to bottom: what this is and where it lands
 * (header + Jira pill), the three templates that fill the boring half of the form, the two
 * fields the reporter actually has to write, then the optional context as two tidy rows.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle, Bug, Check, Cloud, KeyRound, Paperclip,
  Send, Ticket as TicketIcon, X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SUBJECT_MAX, TicketFormFields } from "@/features/tickets/components/TicketForm";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createTicketApi,
  listActiveDomains,
  improveTicketDescription,
  listTicketDestinations,
  ticketAssignees,
  ticketAttachmentAdd,
  type CategoryAssignee,
} from "@/features/tickets/api";

export type CreateTicketPreset = {
  subject?: string;
  description?: string;
  sessionId?: string | null;
  /** The routing domain the assistant filed the answer under. Seeds the category, which in
   *  turn seeds the request type, the project and the assignee pool — Jira Service Management
   *  routes by request type, so a ticket with no category is a ticket nobody owns. */
  domain?: string;
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
  // Deliberately empty: "General" is a routing dead end (no request type, no owner pool), so
  // the reporter has to say where the ticket belongs instead of accepting a silent default.
  category: "",
  priority: "medium",
  assignee: "",
  due_date: "",
  /* Jira create-screen fields. Components must already exist in the project; labels are free. */
  components: "",
  labels: "",
  original_estimate: "",
};


/**
 * Templates are one click that changes the form, not a label for a field.
 *
 * Each one sets the category (matched against the live domain list, because those labels are
 * per-deployment), the priority, a subject prefix, and the skeleton of a description. The
 * skeleton is only written into an empty description: a reporter who has already typed, or a
 * chat answer that pre-filled the text, must never be overwritten.
 *
 * `prefix` is used to both add and strip the marker, so switching templates replaces it
 * instead of stacking "Bug: Access request: …".
 */
const TEMPLATES = [
  {
    key: "bug",
    label: "Report a bug",
    hint: "Something is broken",
    icon: Bug,
    match: /bug|incident|problem|support/i,
    priority: "high",
    prefix: "Bug: ",
    description:
      "What happened:\n\nWhat I expected:\n\nSteps to reproduce:\n1. \n2. \n\nWhen it started:\n\nWho is affected:\n",
  },
  {
    key: "access",
    label: "Request access",
    hint: "Permissions, accounts",
    icon: KeyRound,
    match: /access|identity|account|user/i,
    priority: "medium",
    prefix: "Access request: ",
    description:
      "System or resource:\n\nAccess level needed (read / write / admin):\n\nBusiness reason:\n\nWhen it is needed by:\n",
  },
  {
    key: "service",
    label: "Service request",
    hint: "Hardware, software, setup",
    icon: Cloud,
    match: /service|request|hardware|software|network|server/i,
    priority: "medium",
    prefix: "",
    description:
      "What I need:\n\nWhy I need it:\n\nWhen I need it:\n\nAny constraints (location, budget, approval):\n",
  },
] as const;

/** Remove any template marker from a subject, so templates replace rather than stack. */
function stripTemplatePrefix(subject: string): string {
  for (const t of TEMPLATES) {
    if (t.prefix && subject.startsWith(t.prefix)) return subject.slice(t.prefix.length);
  }
  return subject;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CreateTicketDialog({ open, onOpenChange, preset, onCreated, onToast }: Props) {
  const [draft, setDraft] = useState({ ...EMPTY });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([
    { key: "general", label: "General" },
  ]);
  const [assignable, setAssignable] = useState<CategoryAssignee[]>([]);
  const [assigneeScope, setAssigneeScope] = useState<"category" | "all">("all");
  const [jiraReady, setJiraReady] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  /* A domain key from the chat ("network") has to become the dropdown's label ("Network"),
     and the dropdown only exists once the domain list has loaded — so remember the request
     and apply it when the options arrive. */
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  /** Set once the reporter has tried to submit: from then on the missing fields are visible. */
  const [tried, setTried] = useState(false);
  /** Which template is applied, so the button can show it and a second click can undo it. */
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reference data is loaded once per mount; the dialog is mounted with the page.
  useEffect(() => {
    listTicketDestinations()
      .then((ds) => setJiraReady(Boolean(ds.find((d) => d.key === "jira")?.configured)))
      .catch(() => setJiraReady(null));
    listActiveDomains()
      .then((ds) => {
        if (!ds.length) return;
        const hasGeneral = ds.some((x) => x.key === "general");
        const list = ds.map((x) => ({ key: x.key, label: x.label }));
        setCategories(hasGeneral ? list : [{ key: "general", label: "General" }, ...list]);
      })
      .catch(() => {});
  }, []);

  // The category decides the pool: choosing "Network" must offer the network team, not the
  // whole directory. Falls back to every assignable user when the category has no mapping.
  useEffect(() => {
    let alive = true;
    setDraft((d) => ({ ...d, assignee: "" }));
    if (!draft.category) {
      setAssignable([]);
      return;
    }
    ticketAssignees(draft.category.toLowerCase())
      .then((d) => {
        if (!alive) return;
        setAssignable(d.assignees ?? []);
        setAssigneeScope(d.configured ? "category" : "all");
        setDraft((prev) => ({ ...prev, assignee: prev.assignee || d.default || "" }));
      })
      .catch(() => { if (alive) setAssignable([]); });
    return () => { alive = false; };
  }, [draft.category, open]);

  // Each opening starts from the preset, not from the previous attempt's leftovers.
  useEffect(() => {
    if (!open) return;
    setDraft({
      ...EMPTY,
      ...(preset?.subject ? { subject: preset.subject.slice(0, SUBJECT_MAX) } : {}),
      ...(preset?.description ? { description: preset.description } : {}),
    });
    setTried(false);
    setPendingDomain(preset?.domain ? preset.domain.toLowerCase() : null);
    setPendingFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The answer's routing domain picks the category as soon as the options are known.
  useEffect(() => {
    if (!open || !pendingDomain) return;
    const match = categories.find(
      (c) => c.key.toLowerCase() === pendingDomain || c.label.toLowerCase() === pendingDomain,
    );
    if (!match) return;
    setDraft((d) =>
      d.category === EMPTY.category || d.category.toLowerCase() === pendingDomain
        ? { ...d, category: match.label }
        : d,
    );
    setPendingDomain(null);
  }, [open, pendingDomain, categories]);

  const missingSubject = tried && !draft.subject.trim();
  const missingDescription = tried && !draft.description.trim();

  async function submit() {
    setTried(true);
    if (!draft.subject.trim()) {
      onToast?.("Ticket subject is required", "err");
      subjectRef.current?.focus();
      return;
    }
    if (!draft.category) {
      onToast?.("Choose a category — it decides the queue and who owns the ticket", "err");
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
        components: draft.components.split(",").map((v) => v.trim()).filter(Boolean),
        labels: draft.labels.split(",").map((v) => v.trim()).filter(Boolean),
        original_estimate: draft.original_estimate.trim() || null,
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
      // Say what Jira actually did with the owner: a silent refusal used to leave the ticket
      // looking claimed here while it sat unassigned there.
      onToast?.(created.assignee
        ? `Ticket ${created.id} created · assigned to ${created.assignee}`
        : `Ticket ${created.id} created · unassigned${created.assignee_error ? " (Jira rejected the assignee)" : ""}`,
        created.assignee_error ? "err" : "ok");
      onCreated?.(created);
    } catch (err: any) {
      onToast?.(err?.message || "Ticket creation failed", "err");
    } finally {
      setCreating(false);
    }
  }

  function applyTemplate(t: (typeof TEMPLATES)[number]) {
    // Second click on the same template removes its marker and leaves the rest alone.
    if (activeTemplate === t.key) {
      setDraft((d) => ({ ...d, subject: stripTemplatePrefix(d.subject) }));
      setActiveTemplate(null);
      return;
    }

    const target = categories.find((c) => t.match.test(c.label) || t.match.test(c.key));
    setDraft((d) => {
      // Strip before trimming: the marker itself ends with a space, so "Bug: ".trim() is
      // "Bug:" and never matches the prefix being removed.
      const base = stripTemplatePrefix(d.subject).trim();
      const subject = t.prefix ? `${t.prefix}${base}` : base;
      // Only an empty description is seeded: never overwrite what the reporter (or the chat
      // answer that opened this dialog) already put there.
      const description = d.description.trim() ? d.description : t.description;
      return {
        ...d,
        category: target ? target.label : d.category,
        priority: t.priority,
        subject,
        description,
      };
    });
    setActiveTemplate(t.key);
    requestAnimationFrame(() => {
      subjectRef.current?.focus();
      const end = subjectRef.current?.value.length ?? 0;
      subjectRef.current?.setSelectionRange(end, end);
    });
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setPendingFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="editor">
        {/* ---- header: what this is, and where it lands ---- */}
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-6 pb-4 pr-14 pt-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--brand-grad-from)] to-[var(--brand-grad-to)] text-white shadow-lg shadow-black/25">
            <TicketIcon className="size-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1">
            <DialogTitle className="text-lg font-bold leading-tight tracking-tight text-foreground">
              Create ticket
            </DialogTitle>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Submit a request to your support team
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={[
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  jiraReady === false
                    ? "border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]"
                    : "border-[var(--border)] bg-[var(--muted)]/40 text-muted-foreground",
                ].join(" ")}
              >
                <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3" />
                {jiraReady === false ? "Jira not connected" : "Connected to Jira"}
              </span>
            </div>

            {jiraReady === false && (
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-[var(--danger)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                Jira is not configured yet — set it up in Settings → Integrations first.
              </p>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {/* ---- quick templates ---- */}
          <div>
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Quick templates
            </span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  data-template={t.key}
                  onClick={() => applyTemplate(t)}
                  title={t.hint}
                  aria-pressed={activeTemplate === t.key}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                    activeTemplate === t.key
                      ? "border-[var(--primary)] bg-[var(--primary)]/15 text-foreground"
                      : "border-[var(--border)] bg-transparent text-foreground hover:border-[var(--primary)]/50 hover:bg-[var(--primary)]/10"
                  }`}
                >
                  <span>{t.label}</span>
                  {activeTemplate === t.key && <Check className="size-3.5" aria-hidden />}
                </button>
              ))}
            </div>
          </div>

          {/* The fields are the shared ticket form — the same ones the chat's review dialog
              and the edit dialog draw, so the three cannot drift apart again. */}
          <TicketFormFields
            values={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            categories={categories}
            assignable={assignable}
            assigneeScope={assigneeScope}
            errors={{ subject: missingSubject, description: missingDescription }}
            onImprove={async () => {
              setDrafting(true);
              try {
                const improved = await improveTicketDescription(draft.description, draft.subject);
                if (improved) {
                  setDraft((d) => ({ ...d, description: improved }));
                  onToast?.("Description improved");
                } else {
                  onToast?.("Nothing came back — try again", "err");
                }
              } catch (e: any) {
                onToast?.(e?.message || "Could not improve the description", "err");
              } finally {
                setDrafting(false);
              }
            }}
            improving={drafting}
            subjectRef={subjectRef}
          />

          {/* ---- attachments ---- */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground">
                Attachments
                <span className="ml-1.5 font-normal text-muted-foreground">(optional · max 10 MB each)</span>
              </span>
              {pendingFiles.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPendingFiles([])}
                  className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
              onClick={() => fileRef.current?.click()}
              className={[
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-5 text-center transition",
                dragging
                  ? "border-[var(--primary)] bg-[var(--primary)]/10"
                  : "border-[var(--border)] bg-transparent hover:border-[var(--primary)]/40 hover:bg-[var(--muted)]/25",
              ].join(" ")}
            >
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
              <p className="text-xs text-muted-foreground">
                Drop files here or{" "}
                <span className="font-semibold text-foreground underline underline-offset-2">browse</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                aria-label="Attachments"
                className="hidden"
              />
            </div>

            {pendingFiles.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {pendingFiles.map((f) => (
                  <li
                    key={`${f.name}:${f.size}`}
                    className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5"
                  >
                    <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {formatBytes(f.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingFiles((prev) => prev.filter((x) => x !== f));
                      }}
                      className="shrink-0 rounded-md p-0.5 text-muted-foreground transition hover:bg-[var(--muted)] hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 border-t border-[var(--border)] px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            className="rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={submit}
            disabled={creating}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-gradient-to-r from-[var(--brand-grad-from)] to-[var(--brand-grad-to)] px-4 text-xs font-semibold text-white shadow-lg shadow-black/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
          >
            <Send className="size-3.5" aria-hidden />
            {creating ? "Creating…" : "Create ticket"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CreateTicketDialog;