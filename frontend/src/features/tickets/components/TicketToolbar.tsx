/**
 * Queue toolbar: one search field, a segmented status switch with live counts, a priority
 * filter, and the applied filters repeated as removable chips.
 *
 * The status switch is the same control the Domains & routing page uses — the states a
 * ticket can be in are visible at once, with how many sit in each, so "11 open, 6 pending"
 * is readable without opening a dropdown. Priority stays a select because its five values
 * would wrap a segmented row into two lines at this width.
 */
import { ChevronDown, Search, X } from "lucide-react";

export type TicketFilters = { query: string; status: string; priority: string };

const PRIORITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const STATUS_TABS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
];

export function TicketToolbar({
  filters,
  counts,
  onChange,
  onReset,
}: {
  filters: TicketFilters;
  counts?: Record<string, number>;
  onChange: (patch: Partial<TicketFilters>) => void;
  onReset: () => void;
}) {
  const q = filters.query.trim();
  const hasFilters = q !== "" || filters.status !== "all" || filters.priority !== "all";

  const chips: { key: keyof TicketFilters; label: string; clear: Partial<TicketFilters> }[] = [];
  if (q) chips.push({ key: "query", label: `“${q}”`, clear: { query: "" } });
  if (filters.status !== "all") {
    const label = STATUS_TABS.find((t) => t.key === filters.status)?.label ?? filters.status;
    chips.push({ key: "status", label: `Status: ${label}`, clear: { status: "all" } });
  }
  if (filters.priority !== "all") {
    chips.push({ key: "priority", label: `Priority: ${PRIORITY_LABEL[filters.priority] ?? filters.priority}`, clear: { priority: "all" } });
  }

  return (
    <div className="px-4 pb-4 sm:px-5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={filters.query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="Search ID, subject, requester or assignee…"
            aria-label="Search tickets"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-9 text-xs outline-none transition placeholder:text-muted-foreground/80 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
          />
          {filters.query && (
            <button
              type="button"
              onClick={() => onChange({ query: "" })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status switch — every state and its count, one tap away. */}
          <div
            role="group"
            aria-label="Filter by status"
            className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border)] bg-background p-0.5"
          >
            {STATUS_TABS.map((tab) => {
              const active = filters.status === tab.key;
              const n = counts?.[tab.key];
              return (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ status: tab.key })}
                  className={[
                    "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-2xs font-medium transition",
                    active
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {tab.label}
                  {typeof n === "number" && (
                    <span
                      className={[
                        "rounded px-1 text-[10px] font-semibold tabular-nums",
                        active ? "bg-black/15" : "bg-[var(--muted)] text-muted-foreground",
                      ].join(" ")}
                    >
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative min-w-0">
            <select
              value={filters.priority}
              onChange={(e) => onChange({ priority: e.target.value })}
              aria-label="Filter by priority"
              className="h-9 w-full appearance-none rounded-lg border border-[var(--border)] bg-background pl-3 pr-8 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
            >
              <option value="all">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>

          <button
            type="button"
            onClick={onReset}
            disabled={!hasFilters}
            className="h-9 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      {hasFilters && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-muted-foreground">Filtered by</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange(chip.clear)}
              aria-label={`Remove filter ${chip.label}`}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-card py-0.5 pl-2 pr-1 text-2xs font-medium transition hover:border-[var(--primary)]/40 hover:bg-muted"
            >
              {chip.label}
              <X className="size-3 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
