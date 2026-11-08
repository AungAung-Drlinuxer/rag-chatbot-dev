/**
 * Top metrics for the Domains & Routing page.
 *
 * Four figures, each counted from the domain list the page already holds: nothing is
 * estimated, and a zero is a real zero. The "needs attention" tile is the only one that
 * changes tone, because it is the only one that asks the reader to do something.
 */
import { AlertTriangle, Layers, Route, Workflow } from "lucide-react";
import type { ReactNode } from "react";

export type DomainTotals = {
  active: number;
  inactive: number;
  keywords: number;
  routed: number;
  attention: number;
};

const TONES = {
  primary: "bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  emerald: "bg-[var(--ok)]/12 text-[var(--ok)]",
  sky: "bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  warn: "bg-[var(--warn)]/12 text-[var(--warn)]",
} as const;

function StatTile({
  icon,
  label,
  value,
  caption,
  tone,
  loading,
  emphasis,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
  tone: keyof typeof TONES;
  loading: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border bg-card p-4 shadow-xs transition",
        emphasis ? "border-[var(--warn)]/40" : "border-[var(--border)]",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={["grid size-9 shrink-0 place-items-center rounded-xl", TONES[tone]].join(" ")} aria-hidden>
          {icon}
        </span>
        <span className="pt-0.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>

      <div className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular-nums">
        {loading ? <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted" /> : value}
      </div>

      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">{caption}</p>
    </div>
  );
}

export function DomainStats({
  totals,
  loading,
}: {
  totals: DomainTotals;
  loading: boolean;
}) {
  return (
    <section aria-label="Routing metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        tone="primary"
        icon={<Layers className="size-4" />}
        label="Active domains"
        value={String(totals.active)}
        caption={
          totals.inactive > 0
            ? `${totals.inactive} inactive — excluded from routing`
            : "Available to the classifier"
        }
        loading={loading}
      />
      <StatTile
        tone="sky"
        icon={<Workflow className="size-4" />}
        label="Keywords"
        value={String(totals.keywords)}
        caption="Triggers across all domains"
        loading={loading}
      />
      <StatTile
        tone="emerald"
        icon={<Route className="size-4" />}
        label="Jira routes"
        value={String(totals.routed)}
        caption="Domains with an escalation project"
        loading={loading}
      />
      <StatTile
        tone="warn"
        icon={<AlertTriangle className="size-4" />}
        label="Needs attention"
        value={String(totals.attention)}
        caption={
          totals.attention === 0
            ? "Every domain has keywords and a route"
            : "Missing keywords, a Jira route, or a clear description"
        }
        loading={loading}
        emphasis={totals.attention > 0}
      />
    </section>
  );
}
