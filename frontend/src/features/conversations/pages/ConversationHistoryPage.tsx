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
import {
  adminListConversations,
  adminConversationMessages,
  adminDownloadConversation,
  adminListAdmins,
} from "@/features/conversations/admin-api";
import { downloadCsv, printReport } from "@/shared/report";
import { ReportActions } from "@/shared/ReportActions";
import { listUsers } from "@/features/users/api";
import { EmptyState, ErrorState, PageShell, PageHeader } from "@/components/ui/page";
import { useUrlParams } from "@/app/useUrlParams";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatCard, StatRow } from "@/components/ui/stat-card";

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
  /** Which LLM answered last (from the assistant message meta), when known. */
  provider?: string | null;
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
  "bg-blue-100 text-blue-700 dark:bg-[var(--accent)] dark:text-[var(--accent-foreground)]",
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

export default function ConversationHistoryPage() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  /* A filtered conversation list is something people send to each other — "the VPN chats
     from Tuesday" — so it lives in the address, like the audit log. */
  const [params, setParams] = useUrlParams(["q", "user", "from", "to", "page"] as const);
  const filterUser = params.user;
  const q = params.q;
  const setFilterUser = (v: string) => setParams({ user: v, page: null });
  const setQ = (v: string) => setParams({ q: v, page: null });
  const [open, setOpen] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [openUser, setOpenUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Conv | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  // v0.21.83 — audit date range + export actions moved into the detail panel
  /* Ten per page, the same rhythm as Users — a conversation list is read page by page,
     not scrolled as one endless strip. */
  const fromDate = params.from;
  const toDate = params.to;
  const page = Math.max(1, Number(params.page) || 1);
  const setFromDate = (v: string) => setParams({ from: v, page: null });
  const setToDate = (v: string) => setParams({ to: v, page: null });
  const setPage = (v: number) => setParams({ page: v <= 1 ? null : String(v) });

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

  /* Exporting a transcript leaves the building, so it goes through a dialog that names the
     administrator the download is recorded for — and the file itself, the audit entry and the
     .txt header all carry that name. A button that silently saved a file could not say who
     asked for it. */
  const [exportFor, setExportFor] = useState<Conv | null>(null);
  const [exportFormat, setExportFormat] = useState<"txt" | "json">("txt");
  const [exportAdmins, setExportAdmins] = useState<{ username: string; email?: string }[]>([]);
  const [exportAdmin, setExportAdmin] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function openExport(c: Conv, format: "txt" | "json") {
    setExportFor(c);
    setExportFormat(format);
    setExportError(null);
    if (exportAdmins.length === 0) {
      void adminListAdmins().then((list) => {
        setExportAdmins(list);
        setExportAdmin((prev) => prev || list[0]?.username || "");
      });
    }
  }

  async function confirmExport() {
    if (!exportFor) return;
    setExportBusy(true);
    setExportError(null);
    try {
      const r = await adminDownloadConversation(exportFor.session_id, exportFormat, exportAdmin || undefined);
      if (!r.ok) throw new Error(`Export failed (HTTP ${r.status})`);
      const b = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `conversation-${exportFor.username}-${exportFor.session_id.slice(0, 8)}.${exportFormat}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExportFor(null);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
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
        <StatRow>
          <StatCard
            tone="primary"
            icon={<LayoutGrid className="size-4" />}
            value={String(convs.length)}
            label="Conversations"
            unit="chats"
            caption="Across your workspace"
            loading={loading}
          />
          <StatCard
            tone="info"
            icon={<List className="size-4" />}
            value={String(totalMsgs)}
            label="Total messages"
            caption="User and assistant messages"
            loading={loading}
          />
          <StatCard
            tone="ok"
            icon={<Users className="size-4" />}
            value={String(activeUsers)}
            label="Active users"
            caption="Distinct users in this result"
            loading={loading}
          />
          <StatCard
            tone="warn"
            icon={<MessageSquare className="size-4" />}
            value={convs.length ? (totalMsgs / convs.length).toFixed(1) : "0"}
            label="Avg messages"
            caption="Per conversation in this result"
            loading={loading}
          />
        </StatRow>

        <div className="min-w-0">
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

            <div className="table-scroll hidden md:block">
              <table className="w-full border-collapse text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-[var(--muted)]/50 text-2xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-3 font-medium">User</th>
                    <th className="px-5 py-3 font-medium">Conversation</th>
                    <th className="hidden px-5 py-3 font-medium md:table-cell">Msgs</th>
                    <th className="hidden px-5 py-3 font-medium lg:table-cell">Provider</th>
                    <th className="hidden px-5 py-3 font-medium sm:table-cell">Last activity</th>
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
                      <td className="px-3 py-3.5 align-middle md:px-5">
                        <div className="line-clamp-2 max-w-[52vw] text-xs font-medium leading-snug text-foreground md:max-w-none">
                          {maskProfanity(c.title) || "(untitled conversation)"}
                        </div>
                      </td>
                      <td className="hidden px-5 py-3.5 align-middle text-muted-foreground md:table-cell">{c.messages}</td>
                      <td className="hidden px-5 py-3.5 align-middle lg:table-cell">
                        {(() => {
                          const key = providerKey(c.provider);
                          return key ? (
                            <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
                              <IntegrationLogo providerKey={key} name={key} size="sm" className="size-3.5" />
                              <span className="capitalize">{key}</span>
                            </span>
                          ) : (
                            <span className="text-2xs text-muted-foreground">—</span>
                          );
                        })()}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-3.5 align-middle text-2xs text-muted-foreground sm:table-cell md:px-5 md:text-xs">{fmt(c.last_at)}</td>
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
                          onAction={() => setParams({ q: null, from: null, to: null, user: null, page: null })}
                        />
                      )}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Below md: the same rows as cards. Hiding the Msgs/Provider columns still left a
                table squeezed onto a 375px screen; the list archetype's answer is a card list. */}
            <div className="divide-y divide-[var(--border)] md:hidden">
              {loading && Array.from({ length: 5 }).map((_, i) => (
                <div key={"msk" + i} className="px-4 py-4">
                  <div className="h-4 animate-pulse rounded bg-muted" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
                  <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              ))}
              {!loading && pageRows.map((c) => (
                <button
                  key={c.session_id}
                  type="button"
                  onClick={() => view(c)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full text-2xs font-bold ${toneFor(c.username)}`}>
                    {c.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block line-clamp-2 text-xs font-medium leading-snug text-foreground">
                      {maskProfanity(c.title) || "(untitled conversation)"}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
                      <span className="truncate">{c.username}</span>
                      <span aria-hidden>·</span>
                      <span>{c.messages} msg</span>
                      <span aria-hidden>·</span>
                      <span className="whitespace-nowrap">{fmt(c.last_at)}</span>
                    </span>
                  </span>
                </button>
              ))}
              {!loading && error && (
                <div className="p-4">
                  <ErrorState compact title="Could not load conversations" detail={error} onRetry={load} />
                </div>
              )}
              {!loading && !error && shown.length === 0 && (
                <div className="p-4">
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
                      onAction={() => setParams({ q: null, from: null, to: null, user: null, page: null })}
                    />
                  )}
                </div>
              )}
            </div>

            {/* range + pager footer — the same footer as Users */}
            {!loading && shown.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-muted-foreground">
                  Showing {rangeStart} to {rangeEnd} of {shown.length} conversations
                </span>
                <div className="flex items-center gap-1.5">
                  <PagerButton label="‹" disabled={safePage <= 1} onClick={() => setPage(Math.max(1, safePage - 1))} />
                  {Array.from({ length: Math.min(pageCount, 5) }).map((_, i) => (
                    <PagerButton key={i} label={String(i + 1)} active={safePage === i + 1} onClick={() => setPage(i + 1)} />
                  ))}
                  {pageCount > 5 && <span className="px-1 text-xs text-muted-foreground">… {pageCount}</span>}
                  <PagerButton label="›" disabled={safePage >= pageCount} onClick={() => setPage(Math.min(pageCount, safePage + 1))} />
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

        </div>

        {/* The transcript used to live in a 380px rail that said "Select a conversation"
            until a row was clicked — a permanent empty column. It is a dialog now: closed
            by default, opened by the row, dismissed with Esc or the backdrop. */}
        <Dialog open={!!detail} onOpenChange={(open) => { if (!open) closeDetail(); }}>
          <DialogContent
            showCloseButton={false}
            size="editor"
          >
            <DialogTitle className="sr-only">Conversation transcript</DialogTitle>
              {detail && (
                <>
                  <div className="border-b border-[var(--border)] px-6 pb-4 pr-14 pt-5">
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
                        onClick={() => openExport(detail, "txt")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--primary)] px-2 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90"
                      >
                        <FileText className="size-3" /> Export .txt
                      </button>
                      <button
                        onClick={() => openExport(detail, "json")}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-2 py-1.5 text-2xs font-semibold transition hover:bg-muted"
                      >
                        <FileJson className="size-3" /> Export .json
                      </button>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
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
                          const isJira = !isUser && /jira|ithd-|ticket/i.test(m.content);
                          const isConfluence = !isUser && /confluence|atlassian|kb\b/i.test(m.content);
                          return (
                            /* The mockup draws every turn as a full-width block: the sender
                               sits top-left of the row and the clock top-right, above the
                               bubble. Only the user's block is inset (92%), matching it. */
                            <div key={i} className={isUser ? "ml-auto w-[92%]" : "w-full"}>
                              <div className="mb-1 flex items-center justify-between gap-2 text-3xs text-muted-foreground">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  {!isUser && <Bot className="size-3 shrink-0" />}
                                  <span className="truncate font-medium">{isUser ? openUser : "IT Assistant"}</span>
                                  {isJira && (
                                    <span className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-foreground)]">
                                      <IntegrationLogo providerKey="jira" name="Jira" size="sm" className="size-2.5" />
                                      Jira
                                    </span>
                                  )}
                                  {isConfluence && (
                                    <span className="inline-flex items-center gap-1 rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-sky-500">
                                      <IntegrationLogo providerKey="confluence" name="Confluence" size="sm" className="size-2.5" />
                                      Confluence
                                    </span>
                                  )}
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
              )}
          </DialogContent>
        </Dialog>

        {/* Export is a decision, not a click: name the administrator it is recorded for. */}
        <Dialog open={!!exportFor} onOpenChange={(o) => { if (!o) setExportFor(null); }}>
          <DialogContent size="confirm">
            <DialogTitle>Export conversation</DialogTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {exportFor
                ? `${exportFor.username} · ${maskProfanity(exportFor.title) || "(untitled conversation)"} · ${exportFor.messages} message${exportFor.messages === 1 ? "" : "s"}`
                : ""}
            </p>

            <div className="mt-4">
              <label htmlFor="export-admin" className="block text-xs font-medium text-foreground">
                Administrator
              </label>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                Recorded in the audit log and in the exported file's header.
              </p>
              <select
                id="export-admin"
                value={exportAdmin}
                onChange={(e) => setExportAdmin(e.target.value)}
                className="mt-2 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 text-sm text-foreground outline-none focus:border-[var(--primary)]"
              >
                {exportAdmins.length === 0 && <option value="">Loading administrators…</option>}
                {exportAdmins.map((a) => (
                  <option key={a.username} value={a.username}>
                    {a.username}{a.email ? ` · ${a.email}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 flex gap-2" role="group" aria-label="Export format">
              {(["txt", "json"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setExportFormat(f)}
                  aria-pressed={exportFormat === f}
                  className={[
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition",
                    exportFormat === f
                      ? "border-[var(--primary)] bg-[var(--accent-soft)] text-[var(--accent-foreground)]"
                      : "border-[var(--border)] text-muted-foreground hover:bg-muted",
                  ].join(" ")}
                >
                  {f === "txt" ? "Text · .txt" : "JSON · .json"}
                </button>
              ))}
            </div>

            {exportError && (
              <p className="mt-3 text-xs text-[var(--danger)]" role="alert">{exportError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportFor(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmExport}
                disabled={exportBusy || !exportAdmin}
                className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50"
              >
                {exportBusy ? "Exporting…" : `Download .${exportFormat}`}
              </button>
            </div>
          </DialogContent>
        </Dialog>

      </main>
    </PageShell>
  );
}

/** Provider ids as they arrive from meta → the asset key. "auto" means the router picked,
    so the mark would be a guess and is not shown. */
function providerKey(provider?: string | null): string | null {
  const p = (provider || "").toLowerCase();
  if (!p || p === "auto") return null;
  if (p.includes("anthropic") || p.includes("claude")) return "anthropic";
  if (p.includes("openrouter")) return "openrouter";
  if (p.includes("deepseek")) return "deepseek";
  if (p.includes("ollama")) return "ollama";
  if (p.includes("openai") || p.includes("gpt")) return "openai";
  if (p.includes("google") || p.includes("gemini")) return "google";
  if (p.includes("azure") || p.includes("microsoft")) return "microsoft";
  return null;
}
