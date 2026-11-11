import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  Bot,
  FileJson,
  FileText,
  LayoutGrid,
  List,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Search,
  SearchX,
  Users,
  X,
} from "lucide-react";
import { adminListConversations, adminConversationMessages, adminDownloadConversation } from "@/features/conversations/admin-api";
import { downloadCsv, printReport } from "@/shared/report";
import { ReportActions } from "@/shared/ReportActions";
import { listUsers } from "@/features/users/api";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";

/**
 * ConversationHistory — v0.21.75/79, restyled to the workspace mockup.
 *
 * Admin-only page: browse every user's chatbot conversations, read the full
 * transcript, and export as .txt / .json.
 *
 * Layout follows the mockup: ADMINISTRATION eyebrow + breadcrumb header, three figures,
 * one toolbar (search / user / date range / Reset) that drives BOTH the list and the
 * transcript panel, then a two-column body — the table on the left, a sticky transcript
 * on the right. The table keeps the mockup's four columns (USER · CONVERSATION · MSGS ·
 * LAST ACTIVITY); the transcript is a rendering of the same messages the export writes, so
 * what you read here is what the download contains.
 *
 * Two things the mockup shows are deliberately NOT reproduced, because the data cannot
 * back them: the "preview … / … in source" table footer and the "Screenshot preview"
 * disclaimer. Those describe a truncated screenshot of a larger list, and this page loads
 * every row it renders (the footer reports exactly that instead).
 */

type Conv = {
  session_id: string;
  username: string;
  title: string;
  messages: number;
  started_at: string | null;
  last_at: string | null;
};

type Msg = { role: string; content: string; created_at: string | null };

/** Server times are UTC (timestamptz); parse so every formatter renders in the viewer's locale. */
function parseTs(ts: string | null): Date | null {
  if (!ts) return null;
  const d = new Date(ts.endsWith("Z") || ts.includes("+") ? ts : ts + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return ts ?? "—";
  return d.toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Date only, month-first — the transcript panel's meta line, e.g. "Nov 01, 2026". */
function fmtDay(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return ts ?? "—";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Clock time only — the transcript bubble's timestamp, e.g. "22:10". */
function fmtTime(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Day bucket for the transcript divider — the mockup prints the full date, never "Today". */
function dayLabel(ts: string | null): string {
  const d = parseTs(ts);
  if (!d) return ts ?? "Unknown date";
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "long", year: "numeric" });
}

const AVATAR_TONES = [
  "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300",
];

function toneFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/* v1.6.1 — mask profanity in org-facing titles */
const _PROFANITY_RE = new RegExp("\\b(f+u+c+k+|sh+i+t+|b+i+t+c+h+|a+s+s+h+o+l+e+|d+a+m+n+)\\b", "gi");
function maskProfanity(text: string): string {
  return (text || "").replace(_PROFANITY_RE, (m) => "✱".repeat(Math.min(6, m.length)));
}

/** One figure per card, counted from the loaded list. */
/** The pager control Users uses: same size, same active fill. */
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

function StatCard({
  icon,
  value,
  title,
  caption,
  loading,
}: {
  icon: React.ReactNode;
  value: string;
  title: string;
  caption: string;
  loading: boolean;
}) {
  return (
    <div data-slot="summary-tile" className="flex h-full flex-col rounded-2xl border border-[var(--border)] bg-card px-4 py-3.5 shadow-xs sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-foreground)]" aria-hidden>{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold leading-none tracking-tight tabular-nums">
        {loading ? <div className="h-8 w-14 animate-pulse rounded bg-muted" /> : value}
      </div>
      <p className="mt-1.5 text-2xs leading-tight text-muted-foreground">{caption}</p>
    </div>
  );
}

export default function ConversationHistoryPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [openUser, setOpenUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conv | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // v0.21.83 — audit date range + export actions moved into the detail panel
  const [fromDate, setFromDate] = useState("");
  /* Ten per page, the same rhythm as Users — a conversation list is read page by page,
     not scrolled as one endless strip. */
  const [page, setPage] = useState(1);
  const [toDate, setToDate] = useState("");

  async function load() {
    setLoading(true);
    // There was no catch here at all: a failed request produced an unhandled rejection and
    // an empty table, which reads as "no conversations exist" rather than "the load failed".
    setError(null);
    try {
      const d = await adminListConversations(filterUser || undefined);
      setConvs(d.conversations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConvs([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filterUser]);
  useEffect(() => {
    listUsers()
      .then((d) => setUsers((d.users ?? []).map((u: any) => u.username).sort()))
      .catch(() => {});
  }, []);

  async function view(c: Conv) {
    // Selecting a row used to await silently: a failed transcript fetch left the previous
    // conversation's messages under the new row's title. The panel now reports its own state.
    setOpen(c.session_id);
    setDetail(c);
    setOpenUser(c.username);
    setDetailLoading(true);
    setDetailError(null);
    setMsgs([]);
    try {
      const d = await adminConversationMessages(c.session_id);
      setMsgs(d.messages ?? []);
      setOpenUser(d.username ?? c.username);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail() {
    setOpen(null);
    setDetail(null);
    setMsgs([]);
    setDetailError(null);
  }

  function download(c: Conv, format: "txt" | "json") {
    adminDownloadConversation(c.session_id, format)
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `conversation-${c.username}-${c.session_id.slice(0, 8)}.${format}`;
        a.click();
      });
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return convs.filter((c) => {
      if (needle && !(c.title.toLowerCase().includes(needle) || c.username.toLowerCase().includes(needle)))
        return false;
      if (fromDate || toDate) {
        const day = (c.last_at ?? "").slice(0, 10);
        if (!day) return false;
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
      }
      return true;
    });
  }, [convs, q, fromDate, toDate]);

  const totalMsgs = convs.reduce((a, c) => a + c.messages, 0);
  const activeUsers = new Set(convs.map((c) => c.username)).size;
  const filtered = q.trim() !== "" || fromDate !== "" || toDate !== "" || filterUser !== "";

  const PER_PAGE = 10;
  const pageCount = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pageRows = shown.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE);
  const rangeStart = shown.length === 0 ? 0 : (safePage - 1) * PER_PAGE + 1;
  const rangeEnd = Math.min(safePage * PER_PAGE, shown.length);

  // Narrowing a filter must not leave the reader on a page that no longer exists.
  useEffect(() => { setPage(1); }, [q, fromDate, toDate, filterUser]);

  /* Reports print/export the *filtered* list, not the ten rows on screen. */
  const reportColumns = [
    { key: "user", label: "User", width: "16%" },
    { key: "title", label: "Conversation", width: "40%" },
    { key: "messages", label: "Msgs", width: "8%" },
    { key: "started", label: "Started", width: "18%" },
    { key: "last", label: "Last activity", width: "18%" },
  ];

  const reportRows = useMemo(
    () => shown.map((c) => ({
      user: c.username,
      title: maskProfanity(c.title) || "(untitled conversation)",
      messages: c.messages,
      started: fmt(c.started_at),
      last: fmt(c.last_at),
      session: c.session_id,
    })),
    [shown],
  );

  const rangeLabel = fromDate || toDate
    ? `${fromDate || "start"} → ${toDate || "today"}`
    : "All conversations";
  const filterSummary = [
    q ? `Search: "${q}"` : "",
    filterUser ? `User: ${filterUser}` : "",
    fromDate || toDate ? `Range: ${rangeLabel}` : "",
  ].filter(Boolean);

  function exportCsv() {
    downloadCsv(`conversations-${new Date().toISOString().slice(0, 10)}.csv`, reportColumns, reportRows);
  }

  function printReportSheet() {
    const ok = printReport({
      title: "Conversation history",
      subtitle: `Workspace · ${rangeLabel}`,
      columns: reportColumns,
      rows: reportRows,
      meta: [`Conversations: ${shown.length}`, ...filterSummary],
    });
    if (!ok) window.alert("Your browser blocked the print window. Allow pop-ups for this site and try again.");
  }

  // Group the transcript by day so the panel can show the mockup's day dividers.
  const grouped = useMemo(() => {
    const out: { day: string; items: Msg[] }[] = [];
    for (const m of msgs) {
      const day = dayLabel(m.created_at);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [msgs]);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        breadcrumbs={["Workspace", "Conversations"]}
        icon={<MessagesSquare className="size-5" />}
        badge={`${convs.length} conversations`}
        title="Conversation history"
        description="Review conversations, explore transcripts, and keep context in one place."
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
            <ReportActions
              onPrint={printReportSheet}
              onExport={exportCsv}
              disabled={shown.length === 0}
              title={`Export ${shown.length} conversations as CSV`}
            />
          </div>
        }
      />

      <main className="space-y-4">
        <section className="grid auto-rows-fr gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<LayoutGrid className="size-4" />}
            value={String(convs.length)}
            title="Conversations"
            caption="Across your workspace"
            loading={loading}
          />
          <StatCard
            icon={<List className="size-4" />}
            value={String(totalMsgs)}
            title="Total messages"
            caption="User and assistant messages"
            loading={loading}
          />
          <StatCard
            icon={<Users className="size-4" />}
            value={String(activeUsers)}
            title="Active users"
            caption="Distinct users in this result"
            loading={loading}
          />
          <StatCard
            icon={<MessageSquare className="size-4" />}
            value={convs.length ? (totalMsgs / convs.length).toFixed(1) : "0"}
            title="Avg messages"
            caption="Per conversation in this result"
            loading={loading}
          />
        </section>

        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* List table — USER · CONVERSATION · MSGS · LAST ACTIVITY, as in the mockup. */}
          <section data-slot="card" className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-xs">
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <h2 className="text-sm font-semibold">
                Conversations
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs font-normal text-muted-foreground">
                  {shown.length}
                </span>
              </h2>
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                Latest activity
                <ArrowDown className="size-3" />
              </span>
            </div>

            {/* toolbar — same position and controls as Users: search, filters, range */}
            <div className="flex flex-wrap items-center gap-2 px-5 pb-4">
<div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search conversation or user..."
              aria-label="Search conversations"
              className="h-10 w-full rounded-xl border border-[var(--border)] bg-background pl-9 pr-9 text-xs outline-none transition placeholder:text-muted-foreground/80 focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            aria-label="Filter by user"
            className="h-9 rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
          >
            <option value="">All users</option>
            {users.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
            className="h-9 w-[145px] rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
          />
          <span aria-hidden className="text-xs text-muted-foreground">—</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
            className="h-9 w-[145px] rounded-lg border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-[var(--primary)] dark:[color-scheme:dark]"
          />
          <button
            type="button"
            onClick={() => { setQ(""); setFilterUser(""); setFromDate(""); setToDate(""); }}
            className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs transition hover:bg-[var(--muted)]"
          >
            Reset
          </button>
            </div>

            <div className="table-scroll overflow-auto">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--muted)]/50 text-2xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Conversation</th>
                    <th className="px-5 py-3 font-medium">Msgs</th>
                    <th className="px-5 py-3 font-medium">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={"sk" + i} className="border-t border-[var(--border)]">
                        <td colSpan={4} className="px-5 py-3">
                          <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
                        </td>
                      </tr>
                    ))
                  )}
                  {!loading && pageRows.map((c) => (
                    <tr
                      key={c.session_id}
                      onClick={() => view(c)}
                      className={[
                        "cursor-pointer border-t border-[var(--border)] text-xs transition",
                        open === c.session_id
                          ? "bg-[var(--accent-soft)]"
                          : "hover:bg-muted/50",
                      ].join(" ")}
                    >
                      <td className="px-5 py-3.5 align-middle">
                        <div className="flex items-center gap-2.5">
                          <span className={`grid size-7 shrink-0 place-items-center rounded-full text-2xs font-bold ${toneFor(c.username)}`}>
                            {c.username.slice(0, 1).toUpperCase()}
                          </span>
                          <span className="truncate text-xs font-medium text-foreground">{c.username}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 align-middle">
                        <div className="text-xs font-medium leading-snug text-foreground">
                          {maskProfanity(c.title) || "(untitled conversation)"}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 align-middle text-muted-foreground">{c.messages}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 align-middle text-muted-foreground">{fmt(c.last_at)}</td>
                    </tr>
                  ))}
                  {error && !loading && (
                    <tr>
                      <td colSpan={4}>
                        <ErrorState
                          compact
                          title="Could not load conversation history"
                          detail={error}
                          onRetry={() => void load()}
                        />
                      </td>
                    </tr>
                  )}
                  {shown.length === 0 && !loading && !error && (
                    <tr><td colSpan={4}>
                      {convs.length === 0 ? (
                        <EmptyState
                          icon={<MessagesSquare className="size-5" />}
                          title="No conversations yet"
                          description="Chat sessions appear here once users start asking the assistant questions."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No conversations match these filters"
                          description={`${convs.length} conversation${convs.length === 1 ? "" : "s"} loaded, but none match the current search or date range.`}
                          actionLabel="Clear filters"
                          onAction={() => { setQ(""); setFromDate(""); setToDate(""); setFilterUser(""); }}
                        />
                      )}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* range + pager footer — the same footer as Users */}
            {!loading && shown.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">
                  Showing {rangeStart} to {rangeEnd} of {shown.length} conversations
                </span>
                <div className="flex items-center gap-1.5">
                  <PagerButton label="‹" disabled={safePage <= 1} onClick={() => setPage((n) => Math.max(1, n - 1))} />
                  {Array.from({ length: Math.min(pageCount, 5) }).map((_, i) => (
                    <PagerButton key={i} label={String(i + 1)} active={safePage === i + 1} onClick={() => setPage(i + 1)} />
                  ))}
                  {pageCount > 5 && <span className="px-1 text-xs text-muted-foreground">… {pageCount}</span>}
                  <PagerButton label="›" disabled={safePage >= pageCount} onClick={() => setPage((n) => Math.min(pageCount, n + 1))} />
                  <span className="ml-2 rounded-lg border border-[var(--border)] px-2 py-1 text-2xs text-muted-foreground">10 / page</span>
                </div>
              </div>
            )}

            <div className="border-t border-[var(--border)] px-5 py-3 text-2xs text-muted-foreground">
              Showing {shown.length} of {convs.length} conversation{convs.length === 1 ? "" : "s"}
              {filtered ? " (filtered)" : ""} · {totalMsgs} message{totalMsgs === 1 ? "" : "s"} in
              this result
            </div>
          </section>

          {/* Detail side panel — header (user · "Conversation transcript" · close), then the
              conversation title, its meta line and the two exports, then the transcript. */}
          <div className="hidden lg:block">
            <div data-slot="card" className="sticky top-6 flex h-[calc(100vh-9rem)] max-h-[640px] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-xs">
              {detail ? (
                <>
                  <div className="border-b border-[var(--border)] px-5 py-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className={`grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold ${toneFor(openUser)}`}>
                          {openUser.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">{openUser}</h3>
                          <div className="truncate text-2xs text-muted-foreground">Conversation transcript</div>
                        </div>
                      </div>
                      <button
                        onClick={closeDetail}
                        aria-label="Close transcript"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <div className="mt-3 text-sm font-semibold leading-snug">
                      {maskProfanity(detail.title) || "(untitled conversation)"}
                    </div>
                    <div className="mt-0.5 text-2xs text-muted-foreground">
                      {detail.messages} message{detail.messages === 1 ? "" : "s"} · {fmtDay(detail.last_at)}
                    </div>

                    <div className="mt-3 flex items-center gap-1.5">
                      <button
                        onClick={() => download(detail, "txt")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"
                      >
                        <FileText className="size-3" /> Export .txt
                      </button>
                      <button
                        onClick={() => download(detail, "json")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-2xs font-semibold transition hover:bg-muted"
                      >
                        <FileJson className="size-3" /> Export .json
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto p-4">
                    {detailLoading && (
                      <div className="space-y-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-10 animate-pulse rounded-lg bg-muted"
                            style={{ width: `${55 + ((i * 13) % 35)}%`, marginLeft: i % 2 ? "auto" : 0 }}
                          />
                        ))}
                      </div>
                    )}
                    {detailError && !detailLoading && (
                      <ErrorState
                        compact
                        title="Could not load this transcript"
                        detail={detailError}
                        onRetry={() => void view(detail)}
                      />
                    )}
                    {!detailLoading && !detailError && msgs.length === 0 && (
                      <div className="grid h-full place-items-center p-6 text-center text-2xs text-muted-foreground">
                        This conversation has no stored messages.
                      </div>
                    )}
                    {!detailLoading && !detailError && grouped.map((g) => (
                      <div key={g.day} className="space-y-3">
                        <div className="flex items-center gap-2 text-3xs uppercase tracking-wider text-muted-foreground">
                          <span className="h-px flex-1 bg-[var(--border)]" />
                          {g.day}
                          <span className="h-px flex-1 bg-[var(--border)]" />
                        </div>
                        {g.items.map((m, i) => {
                          const isUser = m.role === "user";
                          return (
                            /* The mockup draws every turn as a full-width block: the sender
                               sits top-left of the row and the clock top-right, above the
                               bubble. Only the user's block is inset (92%), matching it. */
                            <div key={i} className={isUser ? "ml-auto w-[92%]" : "w-full"}>
                              <div className="mb-1 flex items-center justify-between gap-2 text-3xs text-muted-foreground">
                                <span className="flex min-w-0 items-center gap-1">
                                  {!isUser && <Bot className="size-3 shrink-0" />}
                                  <span className="truncate font-medium">{isUser ? openUser : "IT Assistant"}</span>
                                </span>
                                <span className="shrink-0">{fmtTime(m.created_at)}</span>
                              </div>
                              <div className={[
                                "w-full whitespace-pre-wrap rounded-lg px-3.5 py-2 text-xs leading-relaxed",
                                isUser
                                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                                  : "bg-[var(--muted)] text-foreground",
                              ].join(" ")}>
                                {m.content}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Honest footer: the panel shows what the API returned, nothing more. */}
                  {!detailLoading && !detailError && msgs.length > 0 && (
                    <div className="border-t border-[var(--border)] px-5 py-2.5 text-3xs text-muted-foreground">
                      {msgs.length} message{msgs.length === 1 ? "" : "s"} in this transcript
                      {detail.messages > msgs.length
                        ? ` · ${detail.messages - msgs.length} more recorded than returned`
                        : ""}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                    <MessagesSquare className="size-6" />
                  </span>
                  <div className="text-xs font-semibold">Select a conversation</div>
                  <p className="max-w-[240px] text-2xs leading-relaxed text-muted-foreground">
                    Click any row in the list to read the full transcript here.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          Transcripts are read-only. Exports contain exactly the messages stored for the
          session; nothing is redacted beyond the profanity mask applied to titles.
        </p>
      </main>
    </PageShell>
  );
}
