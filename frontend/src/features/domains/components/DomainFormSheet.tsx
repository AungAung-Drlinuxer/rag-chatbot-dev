/**
 * The Add / Edit domain sheet.
 *
 * One form, two clearly different states:
 *   create — the key is permanent and explained up front; the primary action says
 *            "Create domain" and is disabled until the required fields are valid.
 *   edit   — the key is READ-ONLY (renaming is a cascade across KB + vectors), and is only
 *            unlocked behind an explicit "Change key" control that repeats the warning.
 *            "Save changes" stays disabled until something actually changed.
 *
 * Validation is per field and inline. There is no single banner that hides which input is
 * wrong; a field shows its own message under itself, marks itself `aria-invalid`, and the
 * first invalid field is focused on submit.
 *
 * Keywords are chips, not a comma-separated string: Enter/comma/Tab adds, Backspace on an
 * empty draft removes the last chip, pasting a list splits it, duplicates are refused with
 * a visible reason.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, ChevronDown, Loader2, Sparkles, Tag, Upload, X,
} from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import { listConnections, type Connection } from "@/features/settings/api";
import {
  type ClassifierDomainItem,
  createClassifierDomain,
  renameClassifierDomain,
  suggestDomainProfile,
  updateClassifierDomain,
} from "@/features/domains/api";
import { COLOR_OPTIONS, ICON_OPTIONS } from "@/features/domains/components/domainMeta";

export type DomainFormMode = "create" | "edit";

type Errors = Partial<Record<"display_name" | "domain_key" | "jira_project" | "keywords" | "description", string>>;

const KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;
const JIRA_RE = /^[A-Z][A-Z0-9_]{1,9}$/;

const INPUT =
  "h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-[var(--primary)]/15";
const OK_BORDER = "border-[var(--border)] focus:border-[var(--primary)]";
const BAD_BORDER = "border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]/15";

function Field({
  label,
  htmlFor,
  hint,
  error,
  optional,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
          {optional && <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">optional</span>}
        </label>
      </div>
      {children}
      {error ? (
        <p className="flex items-start gap-1 text-2xs text-[var(--danger)]" role="alert">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p className="text-2xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function DomainFormSheet({
  open,
  mode,
  domain,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: DomainFormMode;
  domain: ClassifierDomainItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = mode === "edit" && !!domain;

  const [displayName, setDisplayName] = useState("");
  const [domainKey, setDomainKey] = useState("");
  const [description, setDescription] = useState("");
  const [jiraProject, setJiraProject] = useState("");
  // Which site this domain's articles come from / tickets go to. Only meaningful once the
  // admin has added more than one site.
  const [confConn, setConfConn] = useState<string>("");
  const [jiraConn, setJiraConn] = useState<string>("");
  const [sites, setSites] = useState<{ confluence: Connection[]; jira: Connection[] }>({ confluence: [], jira: [] });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [icon, setIcon] = useState("BookOpen");
  const [color, setColor] = useState("blue");
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [active, setActive] = useState(true);

  const [renameOpen, setRenameOpen] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [keywordNote, setKeywordNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const keyRef = useRef<HTMLInputElement>(null);
  const jiraRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Reset the sheet every time it opens — no state leaking between create and edit. */
  useEffect(() => {
    if (!open) return;
    const d = editing ? domain! : null;
    setDisplayName(d?.display_name ?? "");
    setDomainKey(d?.domain_key ?? "");
    setDescription(d?.description ?? "");
    setJiraProject(d?.jira_project ?? "");
    setConfConn(d?.confluence_connection_id ? String(d.confluence_connection_id) : "");
    setJiraConn(d?.jira_connection_id ? String(d.jira_connection_id) : "");
    setKeywords(d?.keywords ?? []);
    setDraft("");
    setIcon(d?.icon || "BookOpen");
    setColor(d?.color || "blue");
    setCustomIcon(d?.custom_icon ?? null);
    setActive(d?.is_active ?? true);
    setRenameOpen(false);
    setErrors({});
    setTouched({});
    setKeywordNote(null);
    setServerError(null);
    setSaving(false);
  }, [open, editing, domain]);

  const initial = useMemo(
    () => ({
      display_name: domain?.display_name ?? "",
      domain_key: domain?.domain_key ?? "",
      description: domain?.description ?? "",
      jira_project: domain?.jira_project ?? "",
      confluence_connection_id: domain?.confluence_connection_id ?? null,
      jira_connection_id: domain?.jira_connection_id ?? null,
      keywords: JSON.stringify(domain?.keywords ?? []),
      icon: domain?.icon || "BookOpen",
      color: domain?.color || "blue",
      custom_icon: domain?.custom_icon ?? null,
      active: domain?.is_active ?? true,
    }),
    [domain],
  );

  useEffect(() => {
    let alive = true;
    Promise.all([listConnections("confluence"), listConnections("jira")])
      .then(([c, j]) => { if (alive) setSites({ confluence: c.connections ?? [], jira: j.connections ?? [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const dirty =
    displayName !== initial.display_name ||
    description !== initial.description ||
    jiraProject !== initial.jira_project ||
    JSON.stringify(keywords) !== initial.keywords ||
    icon !== initial.icon ||
    color !== initial.color ||
    customIcon !== initial.custom_icon ||
    active !== initial.active ||
    (renameOpen && domainKey !== initial.domain_key);

  function validate(fields: { display_name?: string; domain_key?: string; jira_project?: string; description?: string; keywords?: string[] }) {
    const next: Errors = {};
    const name = (fields.display_name ?? displayName).trim();
    const key = (fields.domain_key ?? domainKey).trim();
    const jira = (fields.jira_project ?? jiraProject).trim();
    const desc = (fields.description ?? description).trim();
    const kws = fields.keywords ?? keywords;

    if (!name) next.display_name = "A display name is required.";
    else if (name.length < 2) next.display_name = "Use at least 2 characters.";
    else if (name.length > 60) next.display_name = "Keep it under 60 characters.";

    if (!editing || renameOpen) {
      if (!key) next.domain_key = "A domain key is required.";
      else if (!KEY_RE.test(key)) next.domain_key = "Lowercase letters, digits and underscores; start with a letter (2–32).";
    }

    if (jira && !JIRA_RE.test(jira)) next.jira_project = "Jira project keys look like ITHD or DBOPS — uppercase, 2–10 characters.";

    if (desc.length > 280) next.description = "Keep the description under 280 characters.";

    if (kws.length > 60) next.keywords = "That is a lot of keywords — 60 is the limit.";

    return next;
  }

  /**
   * Validation runs on every keystroke, but a message only appears for a field the user is
   * editing right now, has already blurred, or after a submit attempt. That keeps a blank
   * form quiet while still correcting mistakes immediately.
   */
  function revalidate(patch: Parameters<typeof validate>[0] = {}, activeField?: keyof Errors) {
    const next = validate(patch);
    const filtered: Errors = {};
    for (const key of Object.keys(next) as (keyof Errors)[]) {
      if (activeField === key || touched[key] || submittedOnce.current) filtered[key] = next[key];
    }
    setErrors(filtered);
  }

  // A submit attempt unlocks every field's message, not just the touched ones.
  const submittedOnce = useRef(false);

  function addKeywords(raw: string) {
    const parts = raw
      .split(/[,\n]/)
      .map((k) => k.trim().toLowerCase().replace(/\s+/g, " "))
      .filter(Boolean);
    if (parts.length === 0) return;

    const existing = new Set(keywords.map((k) => k.toLowerCase()));
    const added: string[] = [];
    let duplicate = false;
    for (const part of parts) {
      if (existing.has(part)) { duplicate = true; continue; }
      existing.add(part);
      added.push(part);
    }

    if (added.length) {
      const next = [...keywords, ...added];
      setKeywords(next);
      revalidate({ keywords: next });
      setKeywordNote(null);
    } else if (duplicate) {
      setKeywordNote("Already in this domain's keyword list.");
    }
    setDraft("");
  }

  function removeKeyword(kw: string) {
    const next = keywords.filter((k) => k !== kw);
    setKeywords(next);
    revalidate({ keywords: next });
    setKeywordNote(null);
  }

  function onDraftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
      if (!draft.trim()) {
        if (e.key === "Enter") e.preventDefault();
        return;
      }
      e.preventDefault();
      addKeywords(draft);
    } else if (e.key === "Backspace" && !draft && keywords.length) {
      e.preventDefault();
      removeKeyword(keywords[keywords.length - 1]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    submittedOnce.current = true;
    const nextErrors = validate({});
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      // Focus the first field that failed, in visual order.
      if (nextErrors.display_name) nameRef.current?.focus();
      else if (nextErrors.domain_key) keyRef.current?.focus();
      else if (nextErrors.jira_project) jiraRef.current?.focus();
      else if (nextErrors.keywords) draftRef.current?.focus();
      return;
    }

    setSaving(true);
    setServerError(null);
    try {
      const payload = {
        display_name: displayName.trim(),
        description: description.trim() || undefined,
        keywords,
        jira_project: jiraProject.trim() || undefined,
        confluence_connection_id: confConn ? Number(confConn) : null,
        jira_connection_id: jiraConn ? Number(jiraConn) : null,
        icon,
        color,
        is_active: active,
      };

      if (editing && domain) {
        const renamed = renameOpen && domainKey.trim() !== domain.domain_key;
        if (renamed) {
          const ok = confirm(
            `Rename domain key "${domain.domain_key}" → "${domainKey.trim()}"?\n\n` +
              "This migrates all KB pages and stored vector metadata in one transaction and cannot be undone.",
          );
          if (!ok) { setSaving(false); return; }
          await renameClassifierDomain(domain.id, domainKey.trim());
        }
        await updateClassifierDomain(domain.id, {
          display_name: payload.display_name,
          description: payload.description ?? "",
          keywords: payload.keywords,
          jira_project: payload.jira_project ?? "",
          confluence_connection_id: payload.confluence_connection_id,
          jira_connection_id: payload.jira_connection_id,
          icon: payload.icon,
          color: payload.color,
          custom_icon: customIcon ?? "",
          is_active: payload.is_active,
        });
      } else {
        await createClassifierDomain({
          domain_key: domainKey.trim(),
          ...payload,
          custom_icon: customIcon || undefined,
        });
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setServerError(err?.message || "Could not save this domain.");
    } finally {
      setSaving(false);
    }
  }

  const PreviewIcon = ICON_OPTIONS[icon]?.icon ?? ICON_OPTIONS.BookOpen.icon;
  const previewColor = COLOR_OPTIONS[color] ?? COLOR_OPTIONS.blue;
  const canSubmit = editing ? dirty && !saving : !saving;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent
        size="editor"
      >
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          {/* ---------- header ---------- */}
          <header className="border-b border-[var(--border)] px-6 pb-4 pt-5 pr-14">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {editing ? "Edit" : "Create"}
            </p>
            <div className="mt-1 flex items-center gap-3">
              <span className={["grid size-10 shrink-0 place-items-center rounded-xl", previewColor.bgClass].join(" ")} aria-hidden>
                {customIcon ? <img src={customIcon} alt="" className="size-full rounded-xl object-contain p-1.5" /> : <PreviewIcon className={["size-4.5", previewColor.textClass].join(" ")} />}
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate text-lg font-bold leading-tight tracking-tight">
                  {editing ? displayName || domain?.display_name : "New routing domain"}
                </DialogTitle>
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {editing ? `Key: ${domain?.domain_key}` : "Keywords decide which knowledge answers a question."}
                </p>
              </div>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-12">
            {serverError && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)] lg:col-span-12" role="alert">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{serverError}</span>
              </div>
            )}

            {/* A domain is the join between knowledge and tickets: Confluence supplies the
                answers, Jira receives what a domain cannot answer. Official marks, not
                generic icons, so the two systems are recognisable at a glance. */}
            <div className="flex flex-wrap items-center gap-2 lg:col-span-12">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-muted/40 px-2 py-1 text-2xs font-medium text-muted-foreground">
                <IntegrationLogo providerKey="confluence" name="Confluence" size="sm" className="size-3.5 shrink-0" />
                Confluence knowledge
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-muted/40 px-2 py-1 text-2xs font-medium text-muted-foreground">
                <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-3.5 shrink-0" />
                {jiraProject ? `Jira project ${jiraProject}` : "Jira project not linked"}
              </span>
            </div>

            <div className="space-y-5 lg:col-span-7">
            {/* ---------- identity ---------- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold">Identity</h3>

              <Field label="Display name" htmlFor="domain-name" error={errors.display_name} hint="Shown to users in chat and on knowledge cards.">
                <input
                  id="domain-name"
                  ref={nameRef}
                  value={displayName}
                  onChange={(e) => { setDisplayName(e.target.value); revalidate({ display_name: e.target.value }, "display_name"); }}
                  onBlur={() => { setTouched((t) => ({ ...t, display_name: true })); revalidate(); }}
                  placeholder="Help Desk & End-User Support"
                  aria-invalid={!!errors.display_name}
                  className={[INPUT, errors.display_name ? BAD_BORDER : OK_BORDER].join(" ")}
                />
              </Field>

              <Field
                label="Domain key"
                htmlFor="domain-key"
                error={errors.domain_key}
                hint={
                  editing
                    ? renameOpen
                      ? "Changing this migrates KB pages and vector metadata in one transaction."
                      : "Used by the classifier and stored on every article. Renaming cascades — unlock it only if you must."
                    : "Permanent identifier, lowercase with underscores. It cannot be changed later without migrating data."
                }
              >
                {editing && !renameOpen ? (
                  <div className="flex h-9 items-center gap-2">
                    <code className="flex h-9 flex-1 items-center rounded-lg border border-[var(--border)] bg-muted/50 px-3 font-mono text-xs text-muted-foreground">
                      {domain?.domain_key}
                    </code>
                    <button
                      type="button"
                      onClick={() => { setRenameOpen(true); setTouched((t) => ({ ...t, domain_key: true })); }}
                      className="h-9 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted"
                    >
                      Change key
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      id="domain-key"
                      ref={keyRef}
                      value={domainKey}
                      onChange={(e) => {
                        const v = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
                        setDomainKey(v);
                        revalidate({ domain_key: v }, "domain_key");
                      }}
                      onBlur={() => { setTouched((t) => ({ ...t, domain_key: true })); revalidate(); }}
                      placeholder="help_desk"
                      aria-invalid={!!errors.domain_key}
                      className={[INPUT, "font-mono", errors.domain_key ? BAD_BORDER : OK_BORDER].join(" ")}
                    />
                    {editing && renameOpen && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-[var(--warn)]/35 bg-[var(--warn)]/10 px-2 py-1.5 text-2xs text-foreground">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--warn)]" aria-hidden />
                        <span>
                          Renaming rewrites every article's domain and vector metadata. You will be asked to confirm.
                          <button type="button" onClick={() => { setRenameOpen(false); setDomainKey(domain?.domain_key ?? ""); }} className="ml-1 underline">
                            Cancel rename
                          </button>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </Field>

              {domain && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-2">
                  <p className="text-2xs leading-4 text-muted-foreground">
                    Draft the description and the keyword fallback from the articles already in
                    this domain.
                  </p>
                  <button
                    type="button"
                    disabled={suggesting}
                    onClick={async () => {
                      setSuggesting(true);
                      setSuggestError(null);
                      try {
                        const out = await suggestDomainProfile(domain.id);
                        if (out.description) setDescription(out.description);
                        if (out.keywords?.length) setKeywords(out.keywords);
                        revalidate({ description: out.description, keywords: out.keywords });
                      } catch (e) {
                        setSuggestError(e instanceof Error ? e.message : "Suggestion failed");
                      } finally {
                        setSuggesting(false);
                      }
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-background px-2.5 text-2xs font-medium transition hover:bg-muted disabled:opacity-50"
                  >
                    <Sparkles className="size-3" aria-hidden />
                    {suggesting ? "Thinking…" : "Suggest with AI"}
                  </button>
                </div>
              )}
              {suggestError && (
                <p role="alert" className="text-2xs text-[var(--danger)]">{suggestError}</p>
              )}

              <Field
                label="Description"
                htmlFor="domain-desc"
                optional
                error={errors.description}
                hint={description.length > 220 ? `${description.length}/280` : "One or two lines the classifier and the team can read at a glance."}
              >
                <textarea
                  id="domain-desc"
                  rows={2}
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); revalidate({ description: e.target.value }, "description"); }}
                  onBlur={() => { setTouched((t) => ({ ...t, description: true })); revalidate(); }}
                  placeholder="PostgreSQL, pooling, locking and query performance procedures."
                  aria-invalid={!!errors.description}
                  className={[
                    "w-full resize-y rounded-lg border bg-background px-3 py-2 text-xs outline-none transition placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-[var(--primary)]/15",
                    errors.description ? BAD_BORDER : OK_BORDER,
                  ].join(" ")}
                />
              </Field>
            </section>

            {/* ---------- keywords ---------- */}
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold">Classifier keywords</h3>
                <span className="text-2xs text-muted-foreground">{keywords.length} added</span>
              </div>

              <Field
                label="Triggers"
                htmlFor="domain-keywords"
                error={errors.keywords}
                hint={
                  keywords.length === 0
                    ? "Optional: the LLM router reads the name and description; keywords are only the offline fallback."
                    : "Enter, comma or Tab adds a keyword. Backspace removes the last one."
                }
              >
                <div
                  className={[
                    "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5 transition focus-within:ring-2 focus-within:ring-[var(--primary)]/15",
                    errors.keywords ? BAD_BORDER : "border-[var(--border)] focus-within:border-[var(--primary)]",
                  ].join(" ")}
                  onClick={() => draftRef.current?.focus()}
                >
                  {keywords.map((kw) => (
                    <span
                      key={kw}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--muted)] py-0.5 pl-1.5 pr-1 text-2xs text-foreground"
                    >
                      <Tag className="size-2.5 text-muted-foreground" aria-hidden />
                      {kw}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeKeyword(kw); }}
                        aria-label={`Remove keyword ${kw}`}
                        className="grid size-4 place-items-center rounded text-muted-foreground transition hover:bg-[var(--danger)]/15 hover:text-[var(--danger)]"
                      >
                        <X className="size-2.5" aria-hidden />
                      </button>
                    </span>
                  ))}

                  <input
                    id="domain-keywords"
                    ref={draftRef}
                    value={draft}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.includes(",")) addKeywords(v);
                      else { setDraft(v); setKeywordNote(null); }
                    }}
                    onKeyDown={onDraftKeyDown}
                    onBlur={() => { if (draft.trim()) addKeywords(draft); }}
                    placeholder={keywords.length ? "Add keyword…" : "postgres, deadlock, slow query"}
                    className="h-6 min-w-[110px] flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
                  />
                </div>
              </Field>

              {keywordNote && (
                <p className="flex items-center gap-1 text-2xs text-[var(--warn)]" role="status">
                  <AlertTriangle className="size-3" aria-hidden /> {keywordNote}
                </p>
              )}
            </section>

            </div>

            <div className="space-y-5 lg:col-span-5">
            {/* ---------- routing ---------- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold">Routing</h3>

              <Field
                label="Jira project"
                htmlFor="domain-jira"
                optional
                error={errors.jira_project}
                hint="Where escalations from this domain are created. Leave empty if this domain never escalates."
              >
                <input
                  id="domain-jira"
                  ref={jiraRef}
                  value={jiraProject}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "");
                    setJiraProject(v);
                    revalidate({ jira_project: v }, "jira_project");
                  }}
                  onBlur={() => { setTouched((t) => ({ ...t, jira_project: true })); revalidate(); }}
                  placeholder="ITHD"
                  aria-invalid={!!errors.jira_project}
                  className={[INPUT, "font-mono uppercase", errors.jira_project ? BAD_BORDER : OK_BORDER].join(" ")}
                />
              </Field>


              {(sites.confluence.length > 1 || sites.jira.length > 1) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {sites.confluence.length > 1 && (
                    <Field label="Confluence site" htmlFor="domain-conf-site" optional
                      hint="Which site this domain's knowledge comes from.">
                      <select id="domain-conf-site" value={confConn} onChange={(e) => setConfConn(e.target.value)}
                        className={[INPUT, "bg-background"].join(" ")}>
                        <option value="">Any / default</option>
                        {sites.confluence.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </Field>
                  )}
                  {sites.jira.length > 1 && (
                    <Field label="Jira site" htmlFor="domain-jira-site" optional
                      hint="Which Jira instance receives this domain's tickets.">
                      <select id="domain-jira-site" value={jiraConn} onChange={(e) => setJiraConn(e.target.value)}
                        className={[INPUT, "bg-background"].join(" ")}>
                        <option value="">Any / default</option>
                        {sites.jira.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
              )}
              <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-muted/20 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block text-xs font-medium">Active</span>
                  <span className="mt-0.5 block text-2xs text-muted-foreground">
                    Inactive domains keep their articles but are skipped by the classifier.
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  aria-label="Active"
                  onClick={() => setActive((v) => !v)}
                  className={[
                    "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition",
                    active ? "bg-[var(--primary)]" : "bg-[var(--border)]",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                      active ? "left-[18px]" : "left-0.5",
                    ].join(" ")}
                  />
                </button>
              </label>
            </section>

            {/* ---------- appearance ---------- */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold">Appearance</h3>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Icon" htmlFor="domain-icon">
                  <div className="relative">
                    <select
                      id="domain-icon"
                      value={icon}
                      disabled={!!customIcon}
                      onChange={(e) => setIcon(e.target.value)}
                      className={[INPUT, OK_BORDER, "appearance-none pr-8 disabled:opacity-50"].join(" ")}
                    >
                      {Object.entries(ICON_OPTIONS).map(([key, opt]) => (
                        <option key={key} value={key}>{opt.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  </div>
                </Field>

                <Field label="Accent">
                  <div className="flex flex-wrap items-center gap-1.5 py-1.5">
                    {Object.entries(COLOR_OPTIONS).map(([key, opt]) => (
                      <button
                        key={key}
                        type="button"
                        title={opt.label}
                        aria-label={`Accent ${opt.label}`}
                        aria-pressed={color === key}
                        onClick={() => setColor(key)}
                        className={[
                          "grid size-5 place-items-center rounded-full transition",
                          opt.swatchBg,
                          color === key ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-background" : "opacity-75 hover:opacity-100",
                        ].join(" ")}
                      >
                        {color === key && <Check className="size-3 text-white" aria-hidden />}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!["image/png", "image/jpeg"].includes(file.type)) { setServerError("Only PNG or JPG images are allowed."); return; }
                    if (file.size > 1024 * 1024) { setServerError("Custom icon must be 1 MB or smaller."); return; }
                    setServerError(null);
                    const reader = new FileReader();
                    reader.onload = () => setCustomIcon(String(reader.result ?? ""));
                    reader.readAsDataURL(file);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-2xs font-medium transition hover:bg-muted"
                >
                  <Upload className="size-3.5" aria-hidden />
                  {customIcon ? "Replace custom icon" : "Upload custom icon"}
                </button>
                {customIcon && (
                  <button
                    type="button"
                    onClick={() => { setCustomIcon(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-2xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10"
                  >
                    <X className="size-3" aria-hidden /> Remove
                  </button>
                )}
                <span className="text-2xs text-muted-foreground">PNG/JPG · 1 MB</span>
              </div>

              <div className="rounded-xl border border-[var(--border)] bg-muted/20 p-3">
                <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className={["grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl", previewColor.bgClass].join(" ")} aria-hidden>
                    {customIcon ? <img src={customIcon} alt="" className="size-full object-contain p-1" /> : <PreviewIcon className={["size-4.5", previewColor.textClass].join(" ")} />}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{displayName || "Domain name"}</p>
                    <p className="mt-0.5 line-clamp-1 text-2xs text-muted-foreground">
                      {description || "Short description appears here"}
                    </p>
                  </div>
                  {!active && <span className="ml-auto rounded-full bg-[var(--muted)] px-2 py-0.5 text-2xs text-muted-foreground">Inactive</span>}
                </div>
              </div>
            </section>
            </div>
          </div>

          {/* ---------- footer ---------- */}
          <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-card px-6 py-3">
            <span className="hidden text-2xs text-muted-foreground sm:block">
              {editing ? (dirty ? "Unsaved changes" : "No changes yet") : "The key cannot be changed later without a migration."}
            </span>
            <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="h-9 flex-1 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-50 sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-4 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : editing ? <Check className="size-3.5" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                {saving ? "Saving…" : editing ? "Save changes" : "Create domain"}
              </button>
            </div>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
