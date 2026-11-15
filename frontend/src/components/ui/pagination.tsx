/**
 * One pagination footer for every list page.
 *
 * Before this file each table grew its own: Knowledge printed `Showing 1–10 of 122`, Users and
 * Conversations printed `Showing 1 to 10 of 12`, and the audit log added a second "98 of 98"
 * line under the first — three spellings of the same sentence, two of them contradicting the
 * page slice they sat under. A reader comparing pages sees three different products.
 *
 * The Knowledge page's version is the reference: an en dash range, real numbered pages with a
 * window (never a dead "… 10"), chevron controls, and the page size stated once.
 */
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** The page numbers to show: first, last, and a window around the current page. */
export function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("gap");
  for (let n = start; n <= end; n += 1) out.push(n);
  if (end < total - 1) out.push("gap");
  out.push(total);
  return out;
}

export function PaginationBar({
  from,
  to,
  total,
  page,
  pageCount,
  onPage,
  pageSize = 10,
  noun,
  note,
  busy = false,
  announce = true,
  aside,
}: {
  /** First row on this page, 1-based. */
  from: number;
  /** Last row on this page, 1-based and inclusive. */
  to: number;
  /** Rows matching the current filters (the number the pager counts). */
  total: number;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  pageSize?: number;
  /** Plural noun, e.g. "conversations" — always plural so the sentence reads the same. */
  noun: string;
  /** Extra muted clause after the range, e.g. "3,400 loaded of 9,000". */
  note?: string;
  /** Disables the controls while a page is in flight. */
  busy?: boolean;
  announce?: boolean;
  /** A second, page-independent fact to sit beside the controls (e.g. keyword totals). */
  aside?: ReactNode;
}) {
  const arrow =
    "grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition " +
    "hover:bg-muted disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted " +
    "disabled:text-muted-foreground/40";

  return (
    <div
      data-slot="pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5"
    >
      <p className="text-xs text-muted-foreground" {...(announce ? { role: "status", "aria-live": "polite" } : {})}>
        {total === 0 ? (
          <>No {noun}</>
        ) : (
          <>
            Showing <span className="font-semibold text-foreground">{from}–{to}</span> of{" "}
            <span className="font-semibold text-foreground">{total.toLocaleString()}</span> {noun}
            {note ? <span className="text-muted-foreground/80"> · {note}</span> : null}
          </>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {aside}
      {pageCount > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-[var(--border)] px-2 py-1 text-2xs text-muted-foreground">
            {pageSize} / page
          </span>

          <nav aria-label="Pagination" className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1 || busy}
              onClick={() => onPage(page - 1)}
              className={arrow}
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>

            {pageWindow(page, pageCount).map((n, i) =>
              n === "gap" ? (
                <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  aria-label={`Page ${n}`}
                  aria-current={n === page ? "page" : undefined}
                  disabled={busy}
                  onClick={() => onPage(n)}
                  className={[
                    "grid size-8 place-items-center rounded-lg border text-xs font-medium transition disabled:opacity-40",
                    n === page
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border-[var(--border)] bg-card hover:bg-muted",
                  ].join(" ")}
                >
                  {n}
                </button>
              ),
            )}

            <button
              type="button"
              aria-label="Next page"
              disabled={page >= pageCount || busy}
              onClick={() => onPage(page + 1)}
              className={arrow}
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </nav>
        </div>
      )}
      </div>
    </div>
  );
}
