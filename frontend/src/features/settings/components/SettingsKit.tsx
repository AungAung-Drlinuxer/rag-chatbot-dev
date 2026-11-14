/**
 * Shared Settings building blocks.
 *
 * The four settings sections used to each invent their own card header, row and field,
 * so "Preferences", "AI service" and "Email server" drifted apart visually even though
 * they answer the same kind of question. These primitives are the single vocabulary:
 * a panel header (icon tile + title + one-line description), label/description rows with
 * the control on the right, and labelled form fields. Colours come from design tokens
 * only, so light (violet/white) and dark (charcoal-navy) both work without variants.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/page";

export const INPUT =
  "h-9 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-xs text-foreground " +
  "outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]";

export const INPUT_MONO =
  "h-9 w-full rounded-xl border border-[var(--border)] bg-background px-3 font-mono text-xs " +
  "text-foreground outline-none transition focus:border-[var(--primary)]";

export const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold " +
  "text-[var(--primary-foreground)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50";

export const BTN_GHOST =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-xs " +
  "font-medium text-foreground transition hover:bg-muted/50 disabled:opacity-50";

export const BTN_DANGER =
  "inline-flex items-center gap-1.5 rounded-xl border border-[var(--danger)]/40 px-3.5 py-2 text-xs " +
  "font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10 disabled:opacity-50";

/** Panel: one decision group. `actions` sits top-right (badges, links, buttons). */
export function Panel({ icon, title, description, actions, children, className = "", padded = false }: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Wrap loose content in the standard body padding. Rows/fields already carry their own
   *  `px-5`, so this is for panels whose children are not Rows — otherwise the text sits
   *  against the card border. */
  padded?: boolean;
}) {
  return (
    <section
      className={
        "overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs " +
        className
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] bg-muted/20 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {padded ? <div className="space-y-4 px-5 py-4">{children}</div> : children}
    </section>
  );
}

/** RailCard: the same header anatomy in a 340px aside — icon tile, title, one line, actions. */
export function RailCard({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-xs">
      <header className="flex items-start gap-2.5 border-b border-[var(--border)] bg-muted/20 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Row: title + hint on the left, the control on the right. Stacks under ~420px. */
export function Row({ title, hint, children, className = "" }: {
  title: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] px-5 py-3.5 first:border-t-0 " +
        className
      }
    >
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A labelled form field, optionally with a status badge on the label line. */
export function Field({ label, hint, badge, icon, children, className = "" }: {
  label: string;
  hint?: string;
  badge?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={"space-y-1.5 " + className}>
      <span className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
        {icon}
        {label}
        {badge}
      </span>
      {children}
      {hint && <p className="text-2xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Two-column field grid that collapses on narrow screens. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
}

/** Small uppercase section divider used inside a panel. */
export function Eyebrow({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] pb-1.5">
      <h3 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h3>
      {hint && <span className="text-2xs text-muted-foreground/70">{hint}</span>}
    </div>
  );
}

/** Segmented option group — the modern replacement for a bare <select> of 2–4 choices. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex rounded-xl border border-[var(--border)] bg-muted/30 p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={[
            "rounded-lg px-3 py-1.5 text-xs font-medium transition",
            value === o.value
              ? "bg-background text-foreground shadow-xs ring-1 ring-[var(--border)]"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Status pill used in every section header (configured / needs setup / not available). */
export function Pill({ tone, children }: {
  tone: "ok" | "warn" | "muted" | "danger";
  children: ReactNode;
}) {
  const map = {
    ok: "bg-[var(--ok)]/12 text-[var(--ok)]",
    warn: "bg-[var(--warn)]/12 text-[var(--warn)]",
    danger: "bg-[var(--danger)]/12 text-[var(--danger)]",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

/** Inline result line for a save/test action. */
export function ResultLine({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p className={`flex items-center gap-1 text-xs ${ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
      {children}
    </p>
  );
}


/* ---------------------------------------------------------------------------
   Section states
   ---------------------------------------------------------------------------
   Every Settings section fetches its own data. Before these existed, a section
   that was still loading (or had failed) rendered its controls with defaults,
   which on a settings page reads as "these are your stored values" — the most
   expensive kind of wrong.
--------------------------------------------------------------------------- */

/** Shaped like a Panel: a header line and `rows` control rows, so nothing jumps on arrival. */
export function SectionSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <div className="rounded-2xl border border-[var(--border)] bg-card">
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <Skeleton className="mt-0.5 size-4 rounded" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-5 py-4 last:border-0">
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A failed fetch, with the retry the reader needs — never a silent default form. */
export function SectionProblem({ title, detail, onRetry }: {
  title: string; detail?: string | null; onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card">
      <ErrorState title={title} detail={detail ?? null} onRetry={onRetry} />
      <p className="px-5 pb-4 text-xs text-muted-foreground">
        Nothing here has been changed. The controls stay hidden until the stored values load.
      </p>
    </div>
  );
}
