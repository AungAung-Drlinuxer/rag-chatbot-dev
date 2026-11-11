/** Tickets feature presentational components — pure, no state, no fetch. */
import { type ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * One figure per card — label top-left, a small coloured dot top-right (the mockup's
 * treatment), the big number, then a muted caption. `accent` only drives the dot colour;
 * the figure itself always comes from the caller's counted value.
 */
export function StatCard({
  label,
  value,
  description,
  accent = "slate",
  onClick,
  title,
}: {
  label: string;
  value: number;
  description: string;
  accent?: "slate" | "blue" | "amber" | "emerald";
  /** v1.5.5 — optional click-to-filter */
  onClick?: () => void;
  /** v1.5.5 — tooltip */
  title?: string;
}) {
  const dots = {
    slate: "bg-slate-400",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    emerald: "bg-emerald-500",
  };

  return (
    <Card
      onClick={onClick}
      title={title}
      className={[
        "gap-0 rounded-xl border-[var(--border)] px-5 py-4 shadow-xs",
        onClick ? "cursor-pointer transition hover:border-[var(--primary)]/40" : "",
      ].join(" ")}
      role={onClick ? "button" : undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>

        <span
          aria-hidden
          className={["size-2 rounded-full", dots[accent]].join(" ")}
        />
      </div>

      <div className="mt-2.5 text-3xl font-semibold tracking-tight">
        {value}
      </div>

      <div className="mt-1 text-xs text-muted-foreground">
        {description}
      </div>
    </Card>
  );
}

export function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>

      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

export function StatusBadge({
  status,
}: {
  status: { label: string; className: string };
}) {
  const meta = status;

  return (
    <Badge
      variant="outline"
      className={["rounded-lg text-xs", meta.className].join(" ")}
    >
      {meta.label}
    </Badge>
  );
}

export function PriorityBadge({
  priority,
  suffix = "",
}: {
  priority: { label: string; className: string; dot: string };
  /** The detail panel reads "Medium priority" in the mockup; the table reads "Medium". */
  suffix?: string;
}) {
  const meta = priority;

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 text-xs font-medium",
        meta.className,
      ].join(" ")}
    >
      <span className={["size-2 rounded-full", meta.dot].join(" ")} />

      {meta.label}
      {suffix}
    </span>
  );
}

export function ActivityItem({
  title,
  text,
  time,
}: {
  title: string;
  text: string;
  time: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-500" />

      <div className="flex-1 rounded-xl bg-muted/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium">
            {title}
          </span>

          <span className="text-xs text-muted-foreground">
            {time}
          </span>
        </div>

        <div className="mt-1 text-xs text-muted-foreground">
          {text}
        </div>
      </div>
    </div>
  );
}

export function RefreshIcon({ className = "mr-2 size-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" />
    </svg>
  );
}
