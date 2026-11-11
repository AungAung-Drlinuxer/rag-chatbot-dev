/**
 * Ticket metric summary.
 *
 * Four figures, all counted from the loaded queue — never estimated. The layout is a strict
 * grid so the numbers share a baseline even when captions wrap to two lines: each card is a
 * column flex with the figure pinned by `mt-auto`-free spacing and equal heights via
 * `h-full`. Every card is also the filter for its own figure (`aria-pressed` says which one
 * is currently applied), which is what makes the row useful rather than decorative.
 */
import type { ReactNode } from "react";
import { AlertOctagon, CheckCircle2, Clock3, Inbox } from "lucide-react";

import { Card } from "@/components/ui/card";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";

export type TicketTotals = {
  total: number;
  open: number;
  pending: number;
  in_progress: number;
  done: number;
  reopened: number;
};

type Tone = "primary" | "amber" | "emerald" | "slate";

const TONES: Record<Tone, { tile: string; ring: string; bar: string }> = {
  primary: {
    tile: "bg-[var(--accent-soft)] text-[var(--primary)]",
    ring: "border-[var(--primary)]/45",
    bar: "bg-[var(--primary)]",
  },
  amber: {
    tile: "bg-[var(--warn)]/12 text-[var(--warn)]",
    ring: "border-[var(--warn)]/55",
    bar: "bg-[var(--warn)]",
  },
  emerald: {
    tile: "bg-[var(--ok)]/12 text-[var(--ok)]",
    ring: "border-[var(--ok)]/55",
    bar: "bg-[var(--ok)]",
  },
  slate: {
    tile: "bg-[var(--muted)] text-muted-foreground",
    ring: "border-[var(--border)]",
    bar: "bg-[var(--border)]",
  },
};

function Tile({
  label,
  value,
  caption,
  icon,
  tone,
  active,
  onClick,
  title,
}: {
  label: string;
  value: number;
  caption: ReactNode;
  icon: ReactNode;
  tone: Tone;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  const t = TONES[tone];

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={active}
      title={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={[
        "group relative h-full cursor-pointer gap-0 overflow-hidden px-4 py-3.5 shadow-xs transition sm:px-5",
        active ? t.ring : "border-[var(--border)] hover:border-[var(--primary)]/35",
      ].join(" ")}
    >
      {/* The active card keeps a colour bar so the applied filter is visible at a glance. */}
      <span
        aria-hidden
        className={["absolute inset-x-0 top-0 h-0.5 transition-opacity", t.bar, active ? "opacity-100" : "opacity-0"].join(" ")}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={["grid size-7 shrink-0 place-items-center rounded-lg", t.tile].join(" ")} aria-hidden>
          {icon}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-3xl">{value}</span>
        <span className="text-2xs text-muted-foreground">
          {value === 1 ? "ticket" : "tickets"}
        </span>
      </div>

      <p className="mt-1.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">{caption}</p>

      {active && (
        <span className="mt-2 inline-flex items-center gap-1 text-2xs font-medium text-[var(--accent-foreground)]">
          <span className={["size-1.5 rounded-full", t.bar].join(" ")} aria-hidden /> Filtering by this
        </span>
      )}
    </Card>
  );
}

export function TicketStats({
  totals,
  activeStatus,
  onPick,
}: {
  totals: TicketTotals;
  activeStatus: string;
  onPick: (status: string) => void;
}) {
  return (
    <section aria-label="Ticket summary" className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <Tile
        label="All tickets"
        value={totals.total}
        caption="Total tickets in this queue"
        icon={<Inbox className="size-3.5" />}
        tone="slate"
        active={activeStatus === "all"}
        onClick={() => onPick("all")}
        title="Show every ticket"
      />
      <Tile
        label="Open"
        value={totals.open}
        caption="Require attention"
        icon={<AlertOctagon className="size-3.5" />}
        tone="primary"
        active={activeStatus === "open"}
        onClick={() => onPick("open")}
        title="Show open tickets only"
      />
      <Tile
        label="Pending"
        value={totals.pending}
        caption="Awaiting a response"
        icon={<Clock3 className="size-3.5" />}
        tone="amber"
        active={activeStatus === "pending"}
        onClick={() => onPick("pending")}
        title="Awaiting the requester to reply or confirm a fix"
      />
      <Tile
        label="In progress"
        value={totals.in_progress}
        caption="Someone is working on it"
        icon={<Clock3 className="size-3.5" />}
        tone="primary"
        active={activeStatus === "in_progress"}
        onClick={() => onPick("in_progress")}
        title="Show tickets that are in progress"
      />
      <Tile
        label="Done"
        value={totals.done}
        caption={
          <span className="inline-flex items-center gap-1">
            <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-2.5 shrink-0" />
            Closed in Jira
          </span>
        }
        icon={<CheckCircle2 className="size-3.5" />}
        tone="emerald"
        active={activeStatus === "done"}
        onClick={() => onPick("done")}
        title="Show tickets that are done"
      />
    </section>
  );
}
