/**
 * DashboardRows.tsx — extracted from DashboardPage.
 *
 * The KPI tiles and the list rows.
 */

import {
  ArrowDownRight,
  ArrowUpRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Domain, HealthItem } from "@/features/dashboard/lib/dashboardTypes";
import type { ReactNode } from "react";

/**
 * One figure per KPI card: icon tile in a soft accent square, muted uppercase label,
 * big number, caption — the reference mockup's KPI panel treatment (rounded-2xl card,
 * 1px border, subtle shadow).
 *
 * `tone` colors the icon tile; `icon` sits inside it. Test-pinned label strings pass
 * through untouched (uppercase is a CSS transform, textContent is unchanged).
 */
// Tones are semantic tokens, not palette literals: the same tile has to hold up in the
// light and the charcoal-navy theme without a per-tone dark: variant.
const TONE_TILE: Record<string, string> = {
  emerald: "bg-[var(--ok)]/12 text-[var(--ok)]",
  orange: "bg-[var(--warn)]/12 text-[var(--warn)]",
  sky: "bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  violet: "bg-[var(--accent)]/35 text-[var(--accent-foreground)]",
  rose: "bg-[var(--danger)]/12 text-[var(--danger)]",
};

export function KpiCard({
  icon,
  tone,
  value,
  title,
  change,
  description,
  positive,
  loading,
  className,
}: {
  icon?: ReactNode;
  value: string;
  title: string;
  change?: string | null;
  description: string;
  positive?: boolean;
  loading: boolean;
  tone?: "sky" | "emerald" | "orange" | "violet" | "rose";
  /** grid placement — used to close an odd KPI row */
  className?: string;
}) {
  return (
    <Card data-slot="summary-tile" className={["gap-0 rounded-2xl border border-[var(--border)] bg-card px-4 py-3.5 shadow-xs", className ?? ""].join(" ")}>
      <div className="flex items-start justify-between gap-2">
        {/* Two reserved lines: "Total conversations" and "Escalated to tickets" wrap on a
            phone instead of being cut to "TOTAL CONVERSA…", and every tile stays the same
            height because the slot is reserved. */}
        <div className="min-h-[2.3em] min-w-0 text-2xs font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
          {title}
        </div>
        {icon && (
          <span
            aria-hidden
            className={["grid size-7 shrink-0 place-items-center rounded-lg", TONE_TILE[tone ?? "sky"]].join(" ")}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-1.5 text-3xl font-semibold leading-none tracking-tight tabular-nums">
        {loading ? (
          <div className="h-6 w-14 animate-pulse rounded bg-muted" />
        ) : (
          value
        )}
      </div>

      {(change != null || description) && (
        <div className="mt-2 flex items-center gap-1.5 text-2xs">
          {change != null &&
            (positive ? (
              <ArrowUpRight className="size-3 text-[var(--ok)]" />
            ) : (
              <ArrowDownRight className="size-3 text-[var(--danger)]" />
            ))}

          {change != null && (
            <span
              className={
                positive ? "font-medium text-[var(--ok)]" : "font-medium text-[var(--danger)]"
              }
            >
              {change}
            </span>
          )}

          {description && (
            <span className="truncate text-muted-foreground" title={description}>
              {description}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/* ============================================================
   SPARKLINE
============================================================ */

export function EscalationRow({
  color,
  label,
  value,
  percentage,
}: {
  color: string;
  label: string;
  value: string;
  percentage: string;
}) {
  return (
    <div className="flex items-center justify-between text-2xs">

      <div className="flex items-center gap-2">
        <span
          className={`size-2 rounded-full ${color}`}
        />

        <span className="text-muted-foreground">
          {label}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-medium">
          {value}
        </span>

        <span className="text-muted-foreground">
          ({percentage})
        </span>
      </div>

    </div>
  );
}

/* ============================================================
   DOMAIN ROW
============================================================ */

/** The reference board colours one bar per domain so a list of six is readable at a glance.
    The colours are the chart tokens (--chart-1..6), not palette classes, so both themes get a
    legible variant; index 0 is the largest domain. */
const CHART_VAR = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)"];

export function DomainRow({
  domain,
  index = 0,
}: {
  domain: Domain;
  index?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-medium text-foreground">
          {domain.name}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-2xs font-medium text-foreground">
            {domain.count}
          </span>
          <span className="w-10 text-right text-2xs text-muted-foreground">
            {domain.percentage}%
          </span>
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            background: CHART_VAR[index % CHART_VAR.length],
            width: `${Math.min(100, Math.max(0, domain.percentage * 3.6))}%`,
          }}
        />
      </div>
    </div>
  );
}

/* ============================================================
   SECTION HEADER
============================================================ */

/* v0.21.64 — Dashboard report: CSV export + printable summary (like Tickets page) */

export function HealthRow({ item }: { item: HealthItem }) {
  const healthy = item.status === "Healthy";

  return (
    // #13 — rows were size-8/py-3.5 for eight services (~560px panel). Compacted to
    // size-7/py-2 with the failure reason inline so a red row explains itself.
    <div className="flex items-center gap-3 px-5 py-2">
      <div
        className={[
          "grid size-7 shrink-0 place-items-center rounded-lg",
          healthy
            ? "bg-muted text-muted-foreground"
            : "bg-[var(--danger)]/12 text-[var(--danger)]",
        ].join(" ")}
      >
        {item.icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-2xs font-medium leading-tight">{item.name}</div>
        {!healthy && item.detail && (
          <div className="mt-0.5 truncate text-2xs leading-tight text-[var(--danger)]" title={item.detail}>
            {item.detail}
          </div>
        )}
      </div>

      {healthy && item.latency_ms != null && (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
          {item.latency_ms}ms
        </span>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden
          className={[
            "size-1.5 rounded-full",
            healthy ? "bg-[var(--ok)]" : "bg-[var(--danger)]",
          ].join(" ")}
        />
        <span className={healthy ? "text-2xs text-[var(--ok)]" : "text-2xs text-[var(--danger)]"}>
          {item.status}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   GATE TREND CHART (v1.1.6)
============================================================ */
