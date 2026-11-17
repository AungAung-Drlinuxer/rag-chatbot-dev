/**
 * Component picker — the Jira project's own component list, not free text.
 *
 * A component is a project-level taxonomy: Jira accepts a name it already knows and rejects
 * the field otherwise, so typing a plausible-sounding name silently cost the reporter their
 * component (`apply_issue_fields` drops the field and the ticket is created without it).
 * The list arrives from `/api/escalations/fields`; when Jira is unconfigured, unreachable, or
 * the project defines none, this renders the plain comma-separated input that came before —
 * the form never loses the ability to submit.
 *
 * The value stays a comma-separated string because that is what the parent form and the API
 * already speak; only the presentation changed.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type JiraComponent = { id: string; name: string };

const FIELD =
  "w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground/70 focus:border-[var(--primary)] focus:outline-none " +
  "focus:ring-2 focus:ring-[var(--primary)]/25";

const chip =
  "inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-muted " +
  "px-2 py-1 text-xs text-foreground";

export function ComponentPicker({
  id = "ticket-components",
  value,
  onChange,
  options,
  disabled = false,
}: {
  id?: string;
  /** Comma-separated component names, as the API takes them. */
  value: string;
  onChange: (next: string) => void;
  options: JiraComponent[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrap = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => value.split(",").map((v) => v.trim()).filter(Boolean),
    [value],
  );
  const known = useMemo(() => new Set(options.map((o) => o.name.toLowerCase())), [options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Close on an outside click: the panel sits inside a dialog that has its own dismiss
  // handler, so leaving it open over the footer hid the submit button behind a list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle(name: string) {
    const has = selected.some((s) => s.toLowerCase() === name.toLowerCase());
    const next = has
      ? selected.filter((s) => s.toLowerCase() !== name.toLowerCase())
      : [...selected, name];
    onChange(next.join(", "));
  }

  // No list to offer — behave exactly like the plain field this replaced.
  if (options.length === 0) {
    return (
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Comma separated; must exist in Jira."
        disabled={disabled}
        className={FIELD}
      />
    );
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${FIELD} flex min-h-[38px] items-center justify-between gap-2 text-left disabled:opacity-60`}
      >
        <span className="flex flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <span className="text-muted-foreground/70">Choose components</span>
          ) : (
            selected.map((name) => (
              <span key={name} className={chip}>
                {name}
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Remove ${name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(name);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggle(name);
                    }
                  }}
                  className="rounded p-0.5 hover:bg-[var(--border)]"
                >
                  <X className="size-3" aria-hidden />
                </span>
              </span>
            ))
          )}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {selected.some((s) => !known.has(s.toLowerCase())) && (
        <p className="mt-1 text-2xs text-[var(--warn)]">
          {selected.filter((s) => !known.has(s.toLowerCase())).join(", ")} — not in this
          project; Jira will reject it.
        </p>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full rounded-xl border border-[var(--border)] bg-card p-2 shadow-xl">
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search components"
              aria-label="Search components"
              className="w-full rounded-lg border border-[var(--border)] bg-background py-1.5 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
          </div>

          <ul role="listbox" aria-multiselectable className="max-h-56 space-y-0.5 overflow-auto">
            {filtered.length === 0 && (
              <li className="px-2 py-2 text-xs text-muted-foreground">No match.</li>
            )}
            {filtered.map((o) => {
              const on = selected.some((s) => s.toLowerCase() === o.name.toLowerCase());
              return (
                <li key={o.id || o.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.name)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                  >
                    <span
                      className={`grid size-4 shrink-0 place-items-center rounded border ${
                        on
                          ? "border-[var(--primary)] bg-[var(--primary)] text-white"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {on && <Check className="size-3" aria-hidden />}
                    </span>
                    <span className="truncate">{o.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ComponentPicker;
