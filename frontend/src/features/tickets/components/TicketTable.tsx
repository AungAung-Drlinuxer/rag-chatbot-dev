/**
 * The ticket queue.
 *
 * Desktop keeps the five-column table the page has always had (sortable, sticky header,
 * selection bar) but tightens the cells: the ticket id and subject are the scan targets, the
 * status is a dot + label so it is readable without relying on colour, and the subject cell
 * carries the metadata that used to be a second line of grey text.
 *
 * Below `md` the same rows render as cards. A five-column table on a 390px screen is either
 * a horizontal scroll or unreadable type; the card shows the same fields in the order a
 * phone user needs them — id + status, subject, category/requester, priority + age.
 *
 * The pager is shared by both views and counts from the real (already filtered) row set.
 */
import { ChevronLeft, ChevronRight, Clock3, Pencil, UserRound } from "lucide-react";

import { priorityMeta, relTime, statusMeta, type Ticket } from "@/features/tickets/model";

export type SortKey = "id" | "subject" | "status" | "priority" | "requester";

const PRIORITY_BAR: Record<string, string> = {
  critical: "bg-[var(--danger)]",
  high: "bg-[var(--warn)]",
  medium: "bg-[var(--primary)]",
  low: "bg-[var(--border)]",
};

// One dot and one pill per Jira status. Colour never carries the meaning on its own — the
// label is always rendered next to the dot.
const STATUS_DOT: Record<string, string> = {
  open: "bg-[var(--primary)]",
  pending: "bg-[var(--warn)]",
  in_progress: "bg-[var(--primary)]",
  done: "bg-[var(--ok)]",
  reopened: "bg-[var(--danger)]",
};

const STATUS_PILL: Record<string, string> = {
  open: "border-[var(--border)] bg-muted text-foreground",
  pending: "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-foreground",
  in_progress: "border-[var(--primary)]/35 bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  done: "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-foreground",
  reopened: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-foreground",
};

export function StatusPill({ status }: { status: Ticket["status"] }) {
  const meta = statusMeta(status);
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-2xs font-medium",
        STATUS_PILL[status] ?? "border-[var(--border)] bg-muted text-muted-foreground",
      ].join(" ")}
    >
      <span className={["size-1.5 rounded-full", STATUS_DOT[status] ?? "bg-muted-foreground"].join(" ")} aria-hidden />
      {meta.label}
    </span>
  );
}

function Priority({ value }: { value: Ticket["priority"] }) {
  const meta = priorityMeta(value);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" title={`${meta.label} priority`}>
      <span className={["h-3 w-0.5 rounded-full", PRIORITY_BAR[value] ?? "bg-[var(--border)]"].join(" ")} aria-hidden />
      <span className="text-foreground">{meta.label}</span>
    </span>
  );
}

function DueChip({ iso }: { iso: string }) {
  const due = new Date(iso);
  const days = Math.ceil((due.getTime() - Date.now()) / 86_400_000);
  const overdue = days < 0;
  const soon = days >= 0 && days <= 2;
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium",
        overdue
          ? "bg-[var(--danger)]/12 text-[var(--danger)]"
          : soon
            ? "bg-[var(--warn)]/15 text-foreground"
            : "bg-muted text-muted-foreground",
      ].join(" ")}
      title={`Due ${due.toLocaleDateString()}`}
    >
      <Clock3 className="size-3" aria-hidden />
      {overdue ? `Overdue ${Math.abs(days)}d` : days === 0 ? "Due today" : `Due in ${days}d`}
    </span>
  );
}

function SortTh({
  k,
  label,
  sortKey,
  sortDir,
  onSort,
  className = "",
}: {
  k: SortKey;
  label: string;
  sortKey: SortKey | null;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === k;
  return (
    <th scope="col" className={["px-4 py-2.5 text-left font-semibold", className].join(" ")} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        className={[
          "inline-flex items-center gap-1 rounded text-2xs uppercase tracking-wide transition",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        ].join(" ")}
      >
        {label}
        <svg viewBox="0 0 12 12" className={["size-2.5 transition", active ? (sortDir === "asc" ? "rotate-180" : "") : "opacity-30"].join(" ")} aria-hidden>
          <path d="M6 9L2 4h8z" fill="currentColor" />
        </svg>
      </button>
    </th>
  );
}

export function TicketTable({
  rows,
  total,
  selectedId,
  onSelect,
  sortKey,
  sortDir,
  onSort,
  page,
  pageCount,
  pageSize,
  onPage,
  onOpenEdit,
}: {
  rows: Ticket[];
  total: number;
  selectedId: string | null;
  onSelect: (t: Ticket) => void;
  sortKey: SortKey | null;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (p: number) => void;
  onOpenEdit?: (t: Ticket) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const pageNumbers = (() => {
    if (pageCount <= 5) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const set = new Set([1, pageCount, page - 1, page, page + 1]);
    return [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  })();

  return (
    <div>
      {/* ---------- desktop table ---------- */}
      <div className="table-scroll hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col className="w-[13%]" />
            <col className="w-[35%]" />
            <col className="w-[14%]" />
            <col className="w-[13%]" />
            <col className="w-[25%]" />
          </colgroup>
          <thead className="border-b border-[var(--border)] bg-muted/40">
            <tr>
              <SortTh k="id" label="Ticket" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="pl-5" />
              <SortTh k="subject" label="Subject" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortTh k="status" label="Status" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortTh k="priority" label="Priority" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
              <SortTh k="requester" label="Requester" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="pr-5" />
            </tr>
          </thead>

          <tbody>
            {rows.map((t) => {
              const selected = selectedId === t.id;
              return (
                <tr
                  key={t.id}
                  aria-selected={selected}
                  onClick={() => onSelect(t)}
                  className={[
                    "group cursor-pointer border-b border-[var(--border)]/70 transition last:border-b-0",
                    selected ? "bg-[var(--accent-soft)]" : "hover:bg-muted/40",
                  ].join(" ")}
                >
                  <td className={["relative py-3 pl-5 pr-2 align-top", selected ? "" : ""].join(" ")}>
                    {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-[var(--primary)]" />}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(t);
                        onOpenEdit?.(t);
                      }}
                      className="font-mono text-2xs font-semibold text-[var(--accent-foreground)] hover:underline"
                      title="Open interactive Jira workflow"
                    >
                      {t.id}
                    </button>
                    <p className="mt-1 text-2xs text-muted-foreground">{relTime(t.updated_at)}</p>
                  </td>

                  <td className="px-4 py-3 align-top">
                    <p className="truncate font-medium text-foreground" title={t.subject}>{t.subject}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{t.category}</span>
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="size-3" aria-hidden />
                        <span className={t.assignee ? "" : "italic text-muted-foreground"}>{t.assignee ?? "Unassigned"}</span>
                      </span>
                      {t.due_date && <DueChip iso={t.due_date} />}
                    </div>
                  </td>

                  <td className="px-4 py-3 align-top"><StatusPill status={t.status} /></td>
                  <td className="px-4 py-3 align-top"><Priority value={t.priority} /></td>
                  <td className="py-3 pl-4 pr-5 align-top">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground" title={t.requester}>
                        {t.requester}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(t);
                          onOpenEdit?.(t);
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2.5 py-1 text-2xs font-semibold text-[var(--lavender)] transition hover:border-[var(--primary)] hover:bg-[var(--primary)]/20 hover:text-white"
                        title="Edit ticket & Jira workflow"
                        aria-label={`Edit ticket ${t.id}`}
                      >
                        <Pencil className="size-3" />
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---------- mobile cards ---------- */}
      <ul className="divide-y divide-[var(--border)] md:hidden">
        {rows.map((t) => {
          const selected = selectedId === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                className={["flex w-full flex-col gap-2 px-4 py-3 text-left transition", selected ? "bg-[var(--accent-soft)]" : "active:bg-muted/60"].join(" ")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-2xs font-semibold text-[var(--accent-foreground)]">{t.id}</span>
                  <StatusPill status={t.status} />
                </div>

                <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{t.subject}</p>

                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 font-medium">{t.category}</span>
                    <span className="inline-flex items-center gap-1">
                      <UserRound className="size-3" aria-hidden />
                      {t.requester}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{t.assignee ?? "Unassigned"}</span>
                    {t.due_date && <DueChip iso={t.due_date} />}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(t);
                      onOpenEdit?.(t);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/10 px-2 py-0.5 text-2xs font-semibold text-[var(--lavender)] hover:bg-[var(--primary)]/20"
                    aria-label={`Edit ticket ${t.id}`}
                  >
                    <Pencil className="size-3" />
                    Edit
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <Priority value={t.priority} />
                  <span className="text-2xs text-muted-foreground">{relTime(t.updated_at)}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* ---------- range + pager ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 sm:px-5">
        <span className="text-2xs text-muted-foreground">
          {pageCount <= 1
            ? `Showing all ${total} ticket${total === 1 ? "" : "s"}`
            : `Showing ${from}–${to} of ${total} tickets`}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="size-3.5" aria-hidden />
          </button>

          {pageNumbers.map((n, i) => {
            const gap = i > 0 && n - pageNumbers[i - 1] > 1;
            return (
              <span key={n} className="flex items-center gap-1">
                {gap && <span className="px-0.5 text-2xs text-muted-foreground">…</span>}
                <button
                  type="button"
                  onClick={() => onPage(n)}
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  className={[
                    "grid size-8 place-items-center rounded-lg border text-2xs font-medium transition",
                    n === page
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {n}
                </button>
              </span>
            );
          })}

          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
            className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
