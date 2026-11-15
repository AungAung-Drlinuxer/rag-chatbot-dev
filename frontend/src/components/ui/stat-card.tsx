import type { ReactNode } from "react";

/**
 * The one summary card.
 *
 * Tickets, Overview, Domains, Users, Knowledge, Conversations and the Audit log all show the same
 * four figures in the same place, so they must not each carry their own copy of this markup — that
 * is how Users ended up with four violet cards while every other page had tone. A card is a
 * `stat-card` (3px accent edge) plus a tinted icon tile and a big tabular figure.
 */
export type StatTone = "primary" | "ok" | "info" | "warn" | "danger" | "muted";

const TONES: Record<StatTone, { edge: string; tile: string }> = {
  primary: { edge: "stat-card--accent", tile: "bg-[var(--accent-soft)] text-[var(--primary)]" },
  ok: { edge: "stat-card--ok", tile: "bg-[var(--ok)]/12 text-[var(--ok)]" },
  info: { edge: "stat-card--info", tile: "bg-[var(--accent-blue)]/12 text-[var(--accent-blue)]" },
  warn: { edge: "stat-card--warn", tile: "bg-[var(--warn)]/12 text-[var(--warn)]" },
  danger: { edge: "stat-card--danger", tile: "bg-[var(--danger)]/12 text-[var(--danger)]" },
  muted: { edge: "stat-card--muted", tile: "bg-[var(--muted)] text-muted-foreground" },
};

export function StatCard({
  tone = "primary",
  icon,
  label,
  value,
  unit,
  caption,
  loading = false,
  onClick,
  active = false,
}: {
  tone?: StatTone;
  icon: ReactNode;
  label: string;
  value: string | number;
  /** The noun after the figure — "users", "events", "articles". Pluralise at the call site. */
  unit?: string;
  caption: string;
  loading?: boolean;
  /** When given, the whole card filters the list below it (and `aria-pressed` reports it). */
  onClick?: () => void;
  active?: boolean;
}) {
  const t = TONES[tone];
  const className = [
    "stat-card h-full w-full px-4 py-3.5 text-left sm:px-5",
    t.edge,
    onClick ? "cursor-pointer transition hover:-translate-y-px hover:border-[var(--primary)]/40" : "",
    active ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--background)]" : "",
  ].join(" ");

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span
          className={["grid size-7 shrink-0 place-items-center rounded-lg", t.tile].join(" ")}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        {loading ? (
          <span className="h-7 w-16 animate-pulse rounded bg-[var(--muted)]" />
        ) : (
          <>
            <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">
              {value}
            </span>
            {unit && <span className="text-2xs text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>
      <p className="mt-1.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
        {loading ? "\u00a0" : caption}
      </p>
    </>
  );

  if (!onClick) {
    return (
      <div data-slot="summary-card" className={className}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-slot="summary-card"
      aria-pressed={active}
      onClick={onClick}
      className={className}
    >
      {body}
    </button>
  );
}

/** The four-across row the cards sit in. Two columns on a phone, four from `xl`. */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <section className="grid auto-rows-fr gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}
