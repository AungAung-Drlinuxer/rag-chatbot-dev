/**
 * Shared page layout primitives (v0.21.0) — one visual system for every page.
 *
 * PageShell  : outer wrapper — consistent vertical padding + centered max width
 * PageHeader : sticky-lite header bar (title, badge, description, actions)
 * SectionCard: white card with header row + body (used for tables, panels, forms)
 *
 * Sizes are fixed here so pages can never drift. Everything below is expressed in
 * DESIGN TOKENS (--primary, --accent, --border) rather than raw Tailwind colours, so a
 * palette change reaches every page at once. Hardcoded `blue-600` / `sky-100` / `slate-900`
 * used to live here, which is why the palette retune did not reach these pages: the
 * primitives were pinned to Tailwind's blue while the app moved to #0048F0.
 *
 * Sizes are fixed here so pages can never drift:
 *   header height 72px · content padding p-5 lg:p-8 · max width 1400px
 *   card radius 12px · titles: page=h1(text-xl) section=text-sm
 */
import { AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function PageShell({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return (
    <div
      data-slot="page-shell"
      className={[
        "bg-[var(--background)] font-[var(--font)] text-sm leading-normal text-[var(--foreground)]",
        /* `fill` locks a page to the viewport height instead of growing past it. The
           dashboard uses it: its bands share one screen so nothing has to be scrolled to
           be read, and the tables scroll INSIDE their own cards instead. Pages that keep
           the default keep today's behaviour exactly. */
        /* Below lg the filled page stacks and scrolls normally: a phone must not be
           squeezed into a desktop board. */
        fill ? "h-full overflow-hidden max-lg:h-auto max-lg:overflow-visible" : "min-h-screen",
      ].join(" ")}
    >
      {/* 1400px, deliberately NOT the chat page's 900px. The chat column holds prose and
          wants a reading measure; these pages hold tables and dashboards, which get worse
          as they narrow — a 7-column ticket table at 900px wraps every row. The shared
          thing is the token set and the rhythm, not one number. */}
      <div
        data-slot="page-content"
        className={[
          "mx-auto w-full max-w-[1400px]",
          fill ? "flex h-full min-h-0 flex-col overflow-hidden p-4 lg:p-5" : "p-5 lg:p-8",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  badge,
  description,
  actions,
  icon,
  eyebrow,
  breadcrumbs,
  dense = false,
}: {
  title: string;
  badge?: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  /**
   * B-5 — breadcrumb trail, e.g. ["Workspace", "Tickets", "ITHD-22"].
   *
   * Rendered inline above the title (v1.3.0), the same shape the chat column uses, after
   * the shell-level top bar was removed: every page now carries its own trail, so the
   * header block scrolls with the content exactly like the chat page's header does.
   */
  breadcrumbs?: string[];
  /** Optional uppercase kicker above the title, e.g. "ADMINISTRATION". */
  eyebrow?: string;
  /**
   * Dense header for a page locked to one screen: no bottom margin, a smaller icon chip
   * and title, and the description kept to one short line.
   */
  dense?: boolean;
}) {
  return (
    <header
      className={[
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        dense ? "mb-0" : "mb-6",
      ].join(" ")}
    >
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3 shrink-0" aria-hidden="true" />}
                <span className={i === breadcrumbs.length - 1 ? "font-medium text-foreground" : ""}>{crumb}</span>
              </span>
            ))}
          </nav>
        )}
        {eyebrow && (
          <div className="mb-1.5 text-xs font-semibold tracking-[0.14em] text-[var(--accent-foreground)]">
            {eyebrow.toUpperCase()}
          </div>
        )}
        <div className="flex items-center gap-3">
        {/* v0.21.67 — standardized page icon chip (every page, both themes) */}
        {icon && (
          <div className={[
            "grid shrink-0 place-items-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)]",
            dense ? "size-9" : "size-11",
          ].join(" ")}>
            {icon}
          </div>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h1 className={["font-semibold tracking-tight", dense ? "text-lg" : "text-xl"].join(" ")}>{title}</h1>
            {badge && (
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-foreground)]">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className={["text-muted-foreground", dense ? "text-xs" : "mt-1 text-xs"].join(" ")}>
              {description}
            </p>
          )}
        </div>
      </div>
        </div>
      {actions && <div data-slot="page-actions" className="flex flex-wrap items-center gap-2 [&_button]:text-xs">{actions}</div>}
    </header>
  );
}

export function SectionCard({
  title,
  description,
  icon,
  actions,
  children,
  bodyClassName = "",
}: {
  // ReactNode rather than string: the Audit log mockup sets the event-count chip on the
  // heading's own line, so a caller has to be able to pass markup. Widening is backward
  // compatible — every existing caller passes a plain string.
  title?: ReactNode;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
      {title && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-muted/20 px-6 py-4.5">
          <div className="flex min-w-0 items-center gap-3.5">
            {icon && (
              <div className="flex size-9 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground)]">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold tracking-tight text-foreground">{title}</h2>
              {description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Shared failure state — icon chip + what went wrong + a Retry.
 *
 * Added with EmptyState's shape on purpose: a page that has a loading state and an empty
 * state but no error state will render its empty state when the request FAILS, which tells
 * the user "you have no tickets" when the truth is "we could not load your tickets". Those
 * are different problems with different next steps, so they get different screens.
 *
 * `detail` takes the raw message; it is shown in a muted monospace line rather than
 * swallowed, because an error the user cannot quote is an error nobody can fix.
 */
export function ErrorState({
  title = "Could not load this page",
  detail,
  onRetry,
  retryLabel = "Try again",
  compact = false,
  banner = false,
}: {
  title?: string;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  /** Inline variant for use inside a table cell or a card body. */
  compact?: boolean;
  /**
   * Horizontal strip for pages that render MANY independent cards. A dashboard's panels
   * load separately, so replacing the whole page with a centred error would hide the data
   * that did arrive; a banner reports the failure and leaves the rest on screen.
   */
  banner?: boolean;
}) {
  if (banner) {
    return (
      <div
        data-slot="error-state"
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
      >
        <AlertTriangle className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{title}.</span>{" "}
          {detail && <span className="font-mono text-xs opacity-80">{detail}</span>}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-white/70 px-2.5 py-1.5 font-medium transition hover:bg-white dark:border-red-800 dark:bg-red-950/40"
          >
            <RefreshCw className="size-3" /> {retryLabel}
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      data-slot="error-state"
      role="alert"
      className={
        compact
          ? "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center"
          : "flex flex-col items-center justify-center px-6 py-16 text-center"
      }
    >
      <div className={`grid place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 ${compact ? "size-9" : "mb-4 size-12"}`}>
        <AlertTriangle className={compact ? "size-4" : "size-5"} />
      </div>
      <h3 className={`font-semibold text-foreground ${compact ? "text-xs" : "text-sm"}`}>{title}</h3>
      {detail && (
        <p className={`mx-auto mt-1 max-w-md break-words font-mono text-xs text-muted-foreground ${compact ? "" : "mt-1.5"}`}>
          {detail}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-background font-medium text-foreground shadow-xs transition hover:bg-muted/50 active:scale-[.98] ${compact ? "mt-2 px-3 py-1.5 text-xs" : "mt-4 px-3.5 py-2 text-xs"}`}
        >
          <RefreshCw className="size-3.5" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Standard primary button styles (use with shadcn Button className) — Linear/Stripe style. */
export const btnPrimary =
  "rounded-lg bg-[var(--primary)] px-4 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-xs transition hover:opacity-90 active:scale-[0.98]";
export const btnSecondary =
  "rounded-lg border border-[var(--border)] bg-background px-4 py-2 text-xs font-medium text-foreground shadow-xs transition hover:bg-muted/50 active:scale-[0.98]";

/** Standard form field label + input classes — Linear/Stripe compact spacing. */
export const fieldLabel = "mb-1.5 block text-xs font-semibold text-foreground";
export const fieldInput =
  "h-9 w-full rounded-lg border border-[var(--border)] bg-background px-3 text-xs text-foreground outline-none transition focus:border-[var(--primary)]";

/** B-11 — shared empty state: icon chip + headline + explanation + active CTA. */
export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-[var(--primary-foreground)] transition-[background-color,transform] duration-150 hover:opacity-90 active:scale-[.98]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
