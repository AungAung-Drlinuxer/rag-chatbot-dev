import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  Clock,
  Copy,
  ListFilter,
  RefreshCw,
  ScrollText,
  Search,
  SearchX,
  UserPlus,
} from "lucide-react";
import { listAudits } from "@/features/audits/api";
import { downloadCsv, printReport } from "@/shared/report";
import { ReportActions } from "@/shared/ReportActions";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";

/**
 * Audits — v1.0.1 (administrator only)
 * Real `audit_log` trail: login / chat / escalate / feedback / sync / admin events
 * with user + action + result filters, client-side paging and CSV export.
 *
 * Layout follows the approved Audit Log mockup: eyebrow -> title -> actions, three
 * summary cards, an "Activity stream" panel with search + action + result filters,
 * a six-column table, then a range/pagination footer.
 *
 * Colours are expressed in the app's design tokens (--primary #0048F0, --border,
 * --muted-foreground) rather than the mockup's literal hexes: the mockup is
 * dark-only, this page must work in both themes and stay consistent with the rest
 * of the app.
 */

type AuditRow = {
  id: number;
  action: string;
  username: string | null;
  domain: string | null;
  confidence: number | null;
  decision: string | null;
  detail: string | null;
  created_at: string | null;
};

const ACTION_TONES: Record<string, string> = {
  apikey: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  login: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  logout: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  chat: "bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  escalate: "bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  feedback: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  sync: "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  "approval.decision": "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  approval: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  domain_blocked: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  domain_deleted: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  guardrail: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  admin: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  rbac: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  settings_update: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  user: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  domain_created: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  domain_updated: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  domain_renamed: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  branding: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  inventory: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function toneFor(action: string): string {
  if (ACTION_TONES[action]) return ACTION_TONES[action];
  for (const k of Object.keys(ACTION_TONES)) {
    if (action.startsWith(k)) return ACTION_TONES[k];
  }
  return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
}

/** Server times are UTC (timestamptz); render them in the viewer's locale. */
function parseTs(ts: string | null): Date | null {
  if (!ts) return null;
  const d = new Date(ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/* v1.6.2 — relative time for hover tooltip */
function relTimeAgo(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return "";
  const mins = Math.floor((Date.now() - d.getTime()) / 6e4);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function fmtDate(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function fmtTime(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

function initials(name: string | null): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  const parts = s.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

/**
 * Result of a row. The live `audit_log` stores decision in {answer, caution, NULL},
 * so anything else is folded into the closest bucket rather than shown raw — a
 * filter whose options do not match the data is worse than no filter.
 */
function resultOf(r: AuditRow): "answer" | "caution" | "none" {
  const d = (r.decision ?? "").toLowerCase();
  if (d === "caution" || d === "rejected" || d === "blocked") return "caution";
  if (d === "answer" || d === "approved") return "answer";
  return "none";
}

const RESULT_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  answer: { dot: "text-emerald-500", text: "text-emerald-600 dark:text-emerald-400", label: "Answer" },
  caution: { dot: "text-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Caution" },
  none: { dot: "text-slate-300 dark:text-slate-600", text: "text-muted-foreground", label: "—" },
};

/**
 * The endpoint clamps `limit` to 500, so that is the largest working set we can hold.
 * Paging and the result filter run over these loaded rows; the footer states how many
 * of the true total are loaded so "no match" is never confused with "not loaded".
 */
const AUDIT_FETCH_LIMIT = 500;

/**
 * Rows shown per page. The mockup's pager pages over a fixed window, and the sibling
 * tickets table fixes its size the same way (a constant, no rows-per-page control), so
 * this page matches both rather than carrying a control the mockup does not show.
 */
const PAGE_SIZE = 10;

function PagerButton({ label, active, disabled, onClick }: {
  label: string; active?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "page" : undefined}
      className={[
        "grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-medium transition",
        active
          ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
          : "border-[var(--border)] bg-card text-foreground hover:bg-[var(--muted)]",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function AuditsPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filterAction, setFilterAction] = useState("");
  const [filterResult, setFilterResult] = useState("");
  const [page, setPage] = useState(1);
  /* Time range, same control pair as Conversations: an audit question is almost always
     "what happened between X and Y", and the log can be far too long to scan. */
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  async function load() {
    setLoading(true);
    // A swallowed error made a failed request render as "no audit events match", which
    // tells the user the data is empty when the truth is that it could not be read.
    setError(null);
    try {
      const d = await listAudits({ limit: AUDIT_FETCH_LIMIT, action: filterAction || undefined });
      setRows(d.audits ?? []);
      setTotal(d.total ?? 0);
      setActions(d.actions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterAction]);

  // Result filtering is client-side on purpose: the endpoint has no `decision` filter,
  // and the value set is tiny (answer | caution | null), so filtering the loaded rows
  // is exact — no server round-trip needed to be correct.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterResult && resultOf(r) !== filterResult) return false;
      const day = (r.created_at ?? "").slice(0, 10);
      if (fromDate && day < fromDate) return false;
      if (toDate && day > toDate) return false;
      if (!needle) return true;
      return (
        (r.username ?? "").toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle) ||
        (r.domain ?? "").toLowerCase().includes(needle) ||
        (r.detail ?? "").toLowerCase().includes(needle)
      );
    });
  }, [rows, q, filterResult, fromDate, toDate]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp rather than reset: narrowing a filter must never leave the view past the
  // last page (a blank table under a "3 / 2" pager), and it should not silently jump
  // the user back to page 1 either.
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const today = useMemo(() => {
    const d0 = new Date().toISOString().slice(0, 10);
    return rows.filter((r) => (r.created_at ?? "").startsWith(d0)).length;
  }, [rows]);
  const users = useMemo(() => new Set(rows.map((r) => r.username).filter(Boolean)).size, [rows]);

  const hasFilters = Boolean(q || filterAction || filterResult || fromDate || toDate);
  function resetFilters() {
    setQ("");
    setFilterAction("");
    setFilterResult("");
    setFromDate("");
    setToDate("");
    setPage(1);
  }

  /* The report is the *filtered* set, labelled like the table — a CSV of raw column names
     ("decision", "confidence") is unreadable in Excel and in a printed pack. */
  const reportColumns = [
    { key: "time", label: "Time", width: "14%" },
    { key: "action", label: "Action", width: "18%" },
    { key: "user", label: "User", width: "14%" },
    { key: "domain", label: "Domain", width: "12%" },
    { key: "decision", label: "Decision", width: "10%" },
    { key: "confidence", label: "Confidence", width: "9%" },
    { key: "detail", label: "Detail", width: "23%" },
  ];

  const reportRows = useMemo(
    () => filtered.map((r) => ({
      time: r.created_at ? r.created_at.replace("T", " ").slice(0, 19) : "",
      action: r.action,
      user: r.username,
      domain: r.domain,
      decision: r.decision,
      confidence: r.confidence,
      detail: r.detail ?? "",
    })),
    [filtered],
  );

  const rangeLabel = fromDate || toDate
    ? `${fromDate || "start"} → ${toDate || "today"}`
    : "All loaded events";

  function exportCsv() {
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, reportColumns, reportRows);
  }

  function printReportSheet() {
    const ok = printReport({
      title: "Audit log",
      subtitle: `Administration · ${rangeLabel}`,
      columns: reportColumns,
      rows: reportRows,
      meta: [
        `Events: ${reportRows.length}`,
        `Users: ${users}`,
        q ? `Search: "${q}"` : "",
        filterAction ? `Action: ${filterAction}` : "",
        filterResult ? `Decision: ${filterResult}` : "",
      ].filter(Boolean),
    });
    if (!ok) window.alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  }

  const rangeStart = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * PAGE_SIZE, filtered.length);

  const actionCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const r of rows) acc[r.action] = (acc[r.action] ?? 0) + 1;
    return Object.entries(acc).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <PageShell>
      <div>
        <PageHeader
          breadcrumbs={["Workspace", "Audit log"]}
          eyebrow="Administration"
          icon={<ScrollText className="size-5" />}
          title="Audit log"
          badge="Administrator"
          description="A clear record of every important action across your workspace."
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                disabled={loading}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 text-xs font-medium text-foreground transition hover:bg-[var(--muted)] disabled:opacity-50"
              >
                <RefreshCw className={["size-3.5", loading ? "animate-spin" : ""].join(" ")} />
                Refresh
              </button>
              {/* Primary: exporting is the page's one "do something" action, so it gets
                  the brand fill that the secondary Refresh deliberately does not. */}
              <ReportActions
                onPrint={printReportSheet}
                onExport={exportCsv}
                disabled={filtered.length === 0}
                title={`Export ${filtered.length} events as CSV`}
              />
            </div>
          }
        />

        {/* summary cards — label left, icon right, big number, muted caption */}
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            icon={<Copy className="size-4" />}
            label="Total events in log"
            value={total.toLocaleString()}
            caption="Across all workspace activity"
          />
          <SummaryCard
            icon={<Clock className="size-4" />}
            label="Today's events"
            value={today.toLocaleString()}
            caption={`${new Date().toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })} · in loaded events`}
          />
          <SummaryCard
            icon={<UserPlus className="size-4" />}
            label="Distinct users"
            value={users.toLocaleString()}
            caption="In loaded events"
          />
          <SummaryCard
            icon={<ListFilter className="size-4" />}
            label="In this range"
            value={filtered.length.toLocaleString()}
            caption={fromDate || toDate ? `${fromDate || "…"} → ${toDate || "…"}` : "No date limit applied"}
          />
        </div>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
        <section data-slot="card" className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Activity stream</h2>
              <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                {filtered.length.toLocaleString()} events
              </span>
            </div>
            <span className="flex items-center gap-1 text-2xs text-muted-foreground">
              Newest first
              <ArrowDown className="size-3" />
            </span>
          </div>
          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
            <div className="relative min-w-[240px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(1); }}
                placeholder="Search user, domain, or detail..."
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background pl-9 pr-3 text-xs outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
                aria-label="Search audit events"
              />
            </div>
            <select
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
              className="h-9 min-w-[150px] rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
              aria-label="Filter by action"
            >
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select
              value={filterResult}
              onChange={(e) => { setFilterResult(e.target.value); setPage(1); }}
              className="h-9 min-w-[140px] rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
              aria-label="Filter by result"
            >
              <option value="">All results</option>
              <option value="caution">Caution</option>
              <option value="answer">Answer</option>
              <option value="none">No result</option>
            </select>
            <div className="flex items-center gap-1.5" role="group" aria-label="Date range">
              <input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
                aria-label="From date"
                className="h-9 w-[140px] rounded-lg border border-[var(--border)] bg-background px-2.5 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
              />
              <span aria-hidden className="text-xs text-muted-foreground">—</span>
              <input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => { setToDate(e.target.value); setPage(1); }}
                aria-label="To date"
                className="h-9 w-[140px] rounded-lg border border-[var(--border)] bg-background px-2.5 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
              />
            </div>
            <button
              onClick={resetFilters}
              disabled={!hasFilters}
              className="h-9 rounded-lg border border-[var(--border)] bg-card px-3 text-xs font-medium transition hover:bg-[var(--muted)] disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          <div className="table-scroll hidden overflow-auto md:block">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col className="w-[15%]" /><col className="w-[13%]" /><col className="w-[15%]" />
                <col className="w-[11%]" /><col className="w-[32%]" /><col className="w-[14%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-[var(--muted)]/40">
                <tr className="text-left text-2xs uppercase tracking-wide text-muted-foreground">
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">Time ↓</th>
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">Action</th>
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">User</th>
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">Domain</th>
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">Detail</th>
                  <th className="border-y border-[var(--border)] px-5 py-3 font-semibold">Result</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={"sk" + i}>
                      <td colSpan={6} className="px-5 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
                      </td>
                    </tr>
                  ))
                )}
                {!loading && pageRows.map((r) => {
                  const res = resultOf(r);
                  const style = RESULT_STYLE[res];
                  return (
                    <tr key={r.id} className="border-b border-[var(--border)] transition hover:bg-[var(--muted)]/40">
                      <td className="whitespace-nowrap px-5 py-3.5" title={relTimeAgo(r.created_at)}>
                        <span className="text-foreground">{fmtDate(r.created_at)}</span>
                        <span className="ml-2 text-muted-foreground">{fmtTime(r.created_at)}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {(() => {
                          const brand = /jira/i.test(r.action) ? "jira" :
                                        /confluence|kb|sync/i.test(r.action) ? "confluence" :
                                        /keycloak|sso|login|auth/i.test(r.action) ? "keycloak" :
                                        /ldap|active.?directory/i.test(r.action) ? "ldap" : null;
                          return (
                            <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-2xs font-semibold capitalize ${toneFor(r.action)}`}>
                              {brand && <IntegrationLogo providerKey={brand} name={brand} size="sm" className="size-2.5 shrink-0" />}
                              {r.action}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-3.5">
                        {r.username ? (
                          <span className="flex items-center gap-2">
                            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-3xs font-semibold text-[var(--accent-foreground)]">
                              {initials(r.username)}
                            </span>
                            <span className="truncate font-medium" title={r.username}>{r.username}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="truncate px-5 py-3.5 text-muted-foreground" title={r.domain ?? ""}>
                        {r.domain ?? "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        {r.detail ? (
                          <span className="block truncate text-muted-foreground" title={r.detail}>{r.detail}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <span className={`inline-flex items-center gap-1.5 text-2xs font-semibold ${style.text}`}>
                          <span aria-hidden className={style.dot}>●</span>
                          {style.label}
                        </span>
                        {/* Confidence is only meaningful when the gate did NOT decide —
                            a percentage printed next to a verdict implies it drove it. */}
                        {res === "none" && r.confidence != null && (
                          <span className="ml-2 text-2xs text-muted-foreground">{Math.round(r.confidence * 100)}%</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!loading && error && (
                  <tr>
                    <td colSpan={6}>
                      <ErrorState
                        compact
                        title="Could not load the audit log"
                        detail={error}
                        onRetry={load}
                      />
                    </td>
                  </tr>
                )}
                {!loading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      {/* Two different situations, two different messages. "No events
                          yet" is a normal state for a new install; "nothing matches your
                          filters" is a user action they can undo — so only that one gets
                          the clear-filters CTA. */}
                      {rows.length === 0 ? (
                        <EmptyState
                          icon={<ScrollText className="size-5" />}
                          title="No audit events yet"
                          description="Administrative actions — sign-ins, permission changes, knowledge edits and approvals — are recorded here as they happen."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No events match these filters"
                          description={`${rows.length} event${rows.length === 1 ? "" : "s"} loaded, but none match the current search or filters.`}
                          actionLabel="Clear filters"
                          onAction={resetFilters}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* mobile: one card per event — six columns cannot be read on a phone */}
          <div className="divide-y divide-[var(--border)] md:hidden">
            {loading && Array.from({ length: 5 }).map((_, i) => (
              <div key={"msk" + i} className="px-4 py-4"><div className="h-14 animate-pulse rounded bg-muted" /></div>
            ))}
            {!loading && pageRows.map((r) => {
              const res = resultOf(r);
              const style = RESULT_STYLE[res];
              return (
                <article key={"mc" + r.id} className="px-4 py-4" data-slot="audit-card">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-2xs text-muted-foreground" title={relTimeAgo(r.created_at)}>
                      {fmtDate(r.created_at)} · {fmtTime(r.created_at)}
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1 text-2xs font-semibold ${style.text}`}>
                      <span aria-hidden className={style.dot}>●</span>{style.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-2xs font-semibold capitalize ${toneFor(r.action)}`}>
                      {r.action}
                    </span>
                    {r.domain && <span className="text-2xs text-muted-foreground">{r.domain}</span>}
                  </div>
                  {r.username && (
                    <p className="mt-1.5 text-2xs text-muted-foreground">{r.username}</p>
                  )}
                  {r.detail && (
                    <p className="mt-1 line-clamp-3 text-2xs leading-relaxed text-muted-foreground">{r.detail}</p>
                  )}
                </article>
              );
            })}
            {!loading && !error && filtered.length === 0 && (
              <div className="p-4">
                {rows.length === 0 ? (
                  <EmptyState icon={<ScrollText className="size-5" />} title="No audit events yet"
                    description="Administrative actions — sign-ins, permission changes, knowledge edits and approvals — are recorded here as they happen." />
                ) : (
                  <EmptyState icon={<SearchX className="size-5" />} title="No matching events"
                    description="Try a wider time range or clear the filters." actionLabel="Reset filters" onAction={resetFilters} />
                )}
              </div>
            )}
          </div>

          {/* range + pagination footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5">
            <span className="text-xs text-muted-foreground">
              {filtered.length === 0
                ? "0 events"
                : `Showing ${rangeStart} to ${rangeEnd} of ${filtered.length} events`}{" "}
              {/* Say so when the log is bigger than one fetch: "no match" must never be
                  read as "this event does not exist". */}
              {total > rows.length && (
                <span className="ml-1.5 text-muted-foreground/80">
                  ({rows.length.toLocaleString()} loaded of {total.toLocaleString()})
                </span>
              )}
            </span>
            <div className="flex items-center gap-1.5">
              <PagerButton label="‹" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
              {Array.from({ length: Math.min(pageCount, 5) }).map((_, i) => (
                <PagerButton key={i} label={String(i + 1)} active={safePage === i + 1} onClick={() => setPage(i + 1)} />
              ))}
              {pageCount > 5 && <span className="px-1 text-xs text-muted-foreground">… {pageCount}</span>}
              <PagerButton label="›" disabled={safePage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} />
              <span className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1 text-2xs text-muted-foreground">10 / page</span>
            </div>
          </div>
        </section>

        <p className="mt-3 flex flex-wrap justify-between gap-3 px-1 text-2xs text-muted-foreground">
          <span>
            Loaded {rows.length.toLocaleString()} of {total.toLocaleString()} events from{" "}
            <code className="font-mono">audit_log</code> · filters apply to loaded rows.
          </span>
          <span>Newest first · server time rendered in your locale</span>
        </p>
        </div>

        {/* Rail: what the stream is made of, so a spike is readable without scanning rows. */}
        <aside className="space-y-4 xl:sticky xl:top-6">
          <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">By action</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Across the {rows.length.toLocaleString()} loaded events.</p>
            <div className="mt-3 space-y-2.5">
              {actionCounts.slice(0, 7).map(([name, n]) => {
                const pct = rows.length ? Math.round((n / rows.length) * 100) : 0;
                return (
                  <div key={name}>
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-muted-foreground" title={name}>{name}</span>
                      <span className="font-medium tabular-nums">{n}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--muted)]">
                      <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {actionCounts.length === 0 && <p className="text-[11px] text-muted-foreground">No events loaded.</p>}
            </div>
          </section>

          <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">By result</h2>
            <dl className="mt-3 space-y-2">
              {(["answer", "caution", "none"] as const).map((key) => (
                <div key={key} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <dt className="text-muted-foreground">
                    {key === "answer" ? "Answered" : key === "caution" ? "Low confidence" : "No answer"}
                  </dt>
                  <dd className="font-medium tabular-nums">{rows.filter((r) => resultOf(r) === key).length}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section data-slot="card" className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">What is recorded</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Sign-ins, domain and user changes, knowledge edits, tickets and assistant answers —
              written by the backend, never edited from this page.
            </p>
          </section>
        </aside>
        </div>
      </div>
    </PageShell>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  caption: string;
}) {
  return (
    <div data-slot="card" className="h-full rounded-2xl border border-[var(--border)] bg-card px-4 py-3.5 shadow-xs sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-foreground)]" aria-hidden>{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{value}</span>
        <span className="text-2xs text-muted-foreground">events</span>
      </div>
      <p className="mt-1.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">{caption}</p>
    </div>
  );
}
