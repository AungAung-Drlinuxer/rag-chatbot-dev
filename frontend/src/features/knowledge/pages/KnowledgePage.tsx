import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpDown,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Database,
  ExternalLink,
  Layers,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";

import {
  searchArticles,
  triggerSync,
  listArticleDomains,
  listArticleSources,
  getSyncStatus,
  listArticles,
} from "@/features/knowledge/api";

import {
  getClassifierDomains,
  type ClassifierDomainItem,
} from "@/features/domains/api";
import {
  COLOR_OPTIONS,
  ICON_OPTIONS,
} from "@/features/domains/components/DomainClassifierManager";

import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { providerOf } from "@/lib/kbProvider";
import ReclassifyPanel from "../components/ReclassifyPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Numbers for a pager: first, last, current ±1, and a gap marker where pages are skipped.
 * Returns e.g. [1, "gap", 4, 5, 6, "gap", 20] — never a wall of 20 buttons.
 */
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (current >= total - 2) [total - 1, total - 2, total - 3].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - (nums[i - 1] as number) > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

/**
 * Knowledge — the KB article browser, restyled to the workspace mockup.
 *
 * Layout follows the mockup: a Workspace / Knowledge breadcrumb under an ADMINISTRATION
 * eyebrow, one heading row whose actions are a sync indicator and the page's single
 * primary button, a row of four equal figures, an amber review band (only when the data
 * supports it), then ONE panel that owns its own heading, toolbar, domain chips, bulk bar,
 * table and range footer.
 *
 * Colours are the app's design tokens (--primary, --border, --muted-foreground) rather
 * than the mockup's literal hexes: the mockup is dark-only, this page must work in both
 * themes. Every figure is counted from a value the component already holds — nothing here
 * invents a number.
 */

type Props = {
  role?: string;
  userName?: string;
  perms?: Record<string, boolean>;
  onToast: (msg: string, kind?: "ok" | "err") => void;
};

type DomainCard = {
  domain: string;
  display_name?: string;
  description?: string;
  icon?: string;
  color?: string;
  custom_icon?: string | null;
  pages: number;
  last_synced: string | null;
};

type RecentItem = {
  title: string;
  domain: string;
  source_url: string;
  updated_by?: string | null;
  last_synced?: string | null;
};

type ListItem = RecentItem & {
  page_id: string;
};

type SyncStatus = {
  pages: number;
  last_run: {
    at: string;
    pages?: number;
    inserted?: number;
    updated?: number;
    skipped?: number;
  } | null;
  state?: "idle" | "queued" | "running" | "done" | "error";
  started_at?: number | null;
  started_by?: string | null;
  run_error?: string | null;
  healthy: boolean;
  beat_interval_minutes: number;
};

/* ==============================================================
   FALLBACK METADATA
============================================================== */

const DOMAIN_META: Record<
  string,
  {
    label: string;
    description: string;
    icon: any;
    iconClass: string;
    bgClass: string;
  }
> = {
  database: {
    label: "Database",
    description: "PostgreSQL, Oracle, SQL, deadlocks, performance",
    icon: BookOpen,
    iconClass: "text-blue-600 dark:text-blue-400",
    bgClass: "bg-blue-50 dark:bg-blue-950/40",
  },
  network: {
    label: "Network & Connectivity",
    description: "VPN, Wi-Fi, DNS, firewall, routing issues",
    icon: BookOpen,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  security: {
    label: "Security & Identity",
    description: "Passwords, MFA, permissions, access requests",
    icon: BookOpen,
    iconClass: "text-purple-600 dark:text-purple-400",
    bgClass: "bg-purple-50 dark:bg-purple-950/40",
  },
  server: {
    label: "Server & Hardware",
    description: "Linux, Windows, hardware, virtualization",
    icon: BookOpen,
    iconClass: "text-indigo-600 dark:text-indigo-400",
    bgClass: "bg-indigo-50 dark:bg-indigo-950/40",
  },
  kubernetes: {
    label: "Kubernetes & Cloud",
    description: "Pods, deployments, clusters, cloud infrastructure",
    icon: BookOpen,
    iconClass: "text-sky-600 dark:text-sky-400",
    bgClass: "bg-sky-50 dark:bg-sky-950/40",
  },
  storage: {
    label: "Storage & Backups",
    description: "NFS, SAN, disk space, backup & restore",
    icon: BookOpen,
    iconClass: "text-cyan-600 dark:text-cyan-400",
    bgClass: "bg-cyan-50 dark:bg-cyan-950/40",
  },
  help_desk: {
    label: "Help Desk & Support",
    description: "General troubleshooting, desktop apps, user onboarding",
    icon: BookOpen,
    iconClass: "text-amber-600 dark:text-amber-400",
    bgClass: "bg-amber-50 dark:bg-amber-950/40",
  },
  general: {
    label: "General IT",
    description: "All other IT questions, company policy, miscellaneous",
    icon: BookOpen,
    iconClass: "text-slate-600 dark:text-slate-400",
    bgClass: "bg-slate-100 dark:bg-slate-800",
  },
};

/** P1#8 — wrap the matched search text so the user can see WHY a row matched. */
function highlight(text: string, term: string) {
  const t = (term || "").trim();
  if (!t) return text;
  const i = text.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-200/70 px-0.5 text-amber-950 dark:bg-amber-500/30 dark:text-amber-100">
        {text.slice(i, i + t.length)}
      </mark>
      {text.slice(i + t.length)}
    </>
  );
}

/** Column names as the table shows them, so the sort summary matches the header. */
const SORT_LABELS: Record<"last_synced" | "title" | "domain", string> = {
  last_synced: "Synced",
  title: "Article Title",
  domain: "Domain",
};

/**
 * A removable filter chip. The label is the filter's human name and the × is the way out,
 * so the user never has to hunt for which control set the filter.
 */
function FilterPill({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--accent-soft)] px-1.5 py-0.5 font-medium text-[var(--accent-foreground)]">
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter ${label}`}
        className="rounded p-0.5 transition hover:bg-black/10 dark:hover:bg-white/10"
      >
        <X className="size-2.5" />
      </button>
    </span>
  );
}

function relTime(iso?: string | null) {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * The mockup renders "Last sync" as a big duration ("28m") with a small "ago" beside it,
 * so the number and the unit are split rather than baked into one string.
 */
function relDuration(iso?: string | null): { value: string; suffix: string } {
  if (!iso) return { value: "never", suffix: "" };
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return { value: "never", suffix: "" };
  const mins = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (mins < 1) return { value: "just now", suffix: "" };
  if (mins < 60) return { value: `${mins}m`, suffix: "ago" };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { value: `${hours}h`, suffix: "ago" };
  return { value: `${Math.round(hours / 24)}d`, suffix: "ago" };
}

/** One figure per card — label left, icon right, big number, muted caption. */
function StatCard({
  icon,
  label,
  value,
  suffix,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  caption: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--border)] bg-card p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-[var(--primary)]">{icon}</span>
      </div>
      <div className="mt-2.5 flex items-baseline gap-1 text-3xl font-semibold tracking-tight text-foreground">
        {value}
        {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
      </div>
      <p className="mt-1.5 text-xs leading-tight text-muted-foreground">{caption}</p>
    </div>
  );
}

export default function Knowledge({ role, onToast }: Props) {
  // v1.1.1 — domain_manager merged into knowledge (single Knowledge Manager role)
  const canManageDomains = role === "admin" || role === "knowledge" || role === "domain_manager";

  // Classifier Domain State — this page reads the domain list only to label the article
  // counts and the domain chips. Editing domains, keywords and routing rules now lives on
  // its own page (features/domains/pages/DomainsPage), which owns the loading/error states.
  const [classifierDomains, setClassifierDomains] = useState<ClassifierDomainItem[]>([]);

  const loadClassifierData = async () => {
    try {
      const res = await getClassifierDomains();
      setClassifierDomains(res.domains ?? []);
    } catch {
      // counts fall back to whatever the article payload reports on its own
    }
  };

  useEffect(() => {
    loadClassifierData();
  }, []);

  // Article / Knowledge Base State
  const [domains, setDomains] = useState<DomainCard[] | null>(null);

  const domainCardMap = useMemo(() => {
    const map = new Map<string, any>();
    classifierDomains.forEach((d: any) => {
      map.set(d.domain_key, {
        domain: d.domain_key,
        display_name: d.display_name,
        description: d.description,
        icon: d.icon || undefined,
        color: d.color || undefined,
        custom_icon: d.custom_icon || null,
        pages: 0,
        last_synced: null,
      });
    });
    return map;
  }, [classifierDomains]);

  const metaFor = (domain?: string) => {
    const key = domain ?? "general";
    const card = domainCardMap.get(key);
    // v1.6.46 — the label must come from the DB, not a hardcoded map.
    // DOMAIN_META only ever held the original 7 domains and the fallback line was
    // `DOMAIN_META[domain] ?? DOMAIN_META.general`, so every domain added later
    // (software_dev, blockchain, cloud_aws, system) rendered as "General IT" —
    // three identical chips on the Knowledge page. Renaming a domain in the
    // Domains & Routing engine was ignored too, because the hardcoded label
    // shadowed the admin's display_name.
    // Order: admin domain list -> RBAC-filtered API list -> hardcoded entry
    // (icon/colour hints only) -> humanised key. It never claims "General IT"
    // for a domain that is not general.
    const apiCard = domains?.find((d) => d.domain === key);
    const fallback = DOMAIN_META[key];
    const humanized = key.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const dynamicIconComp = card?.icon && ICON_OPTIONS[card.icon]?.icon;
    const resolvedIcon = dynamicIconComp || fallback?.icon || BookOpen;
    const dynamicColorDef = card?.color && COLOR_OPTIONS[card.color];
    const resolvedIconClass = dynamicColorDef
      ? dynamicColorDef.textClass
      : fallback?.iconClass || "text-blue-600 dark:text-blue-400";
    const resolvedBgClass = dynamicColorDef
      ? dynamicColorDef.bgClass
      : fallback?.bgClass || "bg-blue-50 dark:bg-blue-950/40";

    return {
      label: card?.display_name || apiCard?.display_name || fallback?.label || humanized,
      description: card?.description || apiCard?.description || fallback?.description || "",
      icon: resolvedIcon,
      iconClass: resolvedIconClass,
      bgClass: resolvedBgClass,
      custom_icon: card?.custom_icon,
    };
  };

  const [items, setItems] = useState<ListItem[] | null>(null);
  // v1.6.47 — real KB size from the API's COUNT(*), not the loaded page size
  const [kbTotal, setKbTotal] = useState<number | null>(null);
  // v1.6.47 — server-side paging/sorting/filtering. Doing any of this in the
  // browser only ever reordered the 50 loaded rows while looking like it had
  // searched the whole KB, which is the same class of wrong answer as the old
  // "50 articles" total.
  /* Ten per page, fixed — the same unit as Users, Conversations and the Audit log, so the
     four lists can be read page for page. A size selector made the Knowledge page the only
     place where "page 2" meant a different amount of work. */
  const pageSize = 10;
  const [sortKey, setSortKey] = useState<"last_synced" | "title" | "domain">("last_synced");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [qField, setQField] = useState<"all" | "title" | "body">("all");
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const [query, setQuery] = useState("");
  const [chip, setChip] = useState("all");
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  // What the SERVER reported for the last list call. The footer range is derived from
  // this, not from page × pageSize, so a short last page can never print a range that
  // runs past the total.
  const [listMeta, setListMeta] = useState<{ offset: number; returned: number; total: number } | null>(null);
  // A relevance search is a different mode from paging a sorted list: its hits are not a
  // slice of the KB, so the pager is replaced by a result count and a way back.
  const [searchMode, setSearchMode] = useState(false);
  const [searchTotal, setSearchTotal] = useState(0);

  // Row → details dialog. Opens the real fields the list row already carries.
  const [detail, setDetail] = useState<ListItem | null>(null);

  // Providers counted from the KB itself — null until the first response arrives, so the
  // figure reads "—" instead of a confident zero.
  const [sources, setSources] = useState<{ key: string; label: string; count: number }[] | null>(null);

  // The amber band's "Review General IT" action scrolls the chip row into view.
  const chipsRef = useRef<HTMLDivElement>(null);

  /** True when anything is narrowing the list — drives the filter summary row. */
  const hasFilters = chip !== "all" || providerFilter !== "all" || query.trim().length > 0 || searchMode;

  async function loadBrowse() {
    const [domainResponse, syncResponse, sourceResponse] = await Promise.all([
      listArticleDomains().catch(() => null),
      getSyncStatus().catch(() => null),
      listArticleSources().catch(() => null),
    ]);

    if (domainResponse?.domains) setDomains(domainResponse.domains);
    if (syncResponse) setStatus(syncResponse);
    if (sourceResponse?.sources) setSources(sourceResponse.sources);
  }

  /** Query string for /api/articles-list. Every narrowing control is explicit here so a
   *  handler can pass the value it is ABOUT to set — reading state in the same tick would
   *  send the previous sort/filter/page-size to the server (the pager bug this fixes). */
  function buildQuery(o: {
    domain: string; q: string; offset: number; limit: number;
    sort: "last_synced" | "title" | "domain"; order: "asc" | "desc"; provider: string;
  }) {
    const parts = new URLSearchParams();
    if (o.domain !== "all") parts.set("domain", o.domain);
    if (o.q.trim()) { parts.set("q", o.q.trim()); parts.set("q_field", qField); }
    if (o.provider !== "all") parts.set("provider", o.provider);
    parts.set("sort", o.sort);
    parts.set("order", o.order);
    parts.set("limit", String(o.limit));
    parts.set("offset", String(o.offset));
    return parts.toString();
  }

  /**
   * Fetch one page. `override` lets a click handler apply the value it just set, and
   * `offset` is explicit so the pager never depends on a stale `page`.
   */
  async function fetchList(
    offset = 0,
    override: Partial<{
      domain: string; q: string; limit: number; provider: string;
      sort: "last_synced" | "title" | "domain"; order: "asc" | "desc";
    }> = {},
  ) {
    const domain = override.domain ?? chip;
    const q = override.q ?? query;
    const limit = override.limit ?? pageSize;
    const provider = override.provider ?? providerFilter;
    const sort = override.sort ?? sortKey;
    const order = override.order ?? sortDir;

    setListing(true);
    setListError(null);
    try {
      const res = await listArticles(buildQuery({ domain, q, offset, limit, sort, order, provider }));
      const articles: ListItem[] = res.articles ?? [];
      const reportedTotal = typeof res.total === "number" ? res.total : articles.length;
      setItems(articles);
      setKbTotal(reportedTotal);
      setListMeta({ offset, returned: articles.length, total: reportedTotal });
      setPage(Math.floor(offset / limit) + 1);

      // A filter or a delete can leave the current offset past the end. Jump to the last
      // real page instead of showing an empty table under a "3 of 3" footer.
      if (reportedTotal > 0 && offset >= reportedTotal) {
        const lastOffset = Math.max(0, Math.floor((reportedTotal - 1) / limit) * limit);
        if (lastOffset !== offset) await fetchList(lastOffset, override);
        return;
      }
    } catch (err) {
      // Kept the toast (it is the app-wide convention for transient failures) AND added
      // the inline state, because a toast disappears and leaves an empty table behind —
      // which reads as "you have no articles" rather than "the request failed".
      setListError(err instanceof Error ? err.message : String(err));
      setItems([]);
      setListMeta(null);
      onToast("Failed to load article list", "err");
    } finally {
      setListing(false);
    }
  }

  /** Any control that narrows or reorders the list restarts at page 1. */
  useEffect(() => {
    if (searchMode) return;
    void fetchList(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip, providerFilter, sortKey, sortDir, pageSize, searchMode]);

  /** Go to a 1-based page number, clamped to the real page count. */
  function goToPage(next: number) {
    const pages = Math.max(1, Math.ceil((kbTotal ?? 0) / pageSize));
    const target = Math.min(Math.max(1, next), pages);
    if (target === page && !listing) return;
    void fetchList((target - 1) * pageSize);
  }

  /** Leave relevance results and return to the paged, filtered library. */
  function clearSearch() {
    setQuery("");
    setSearchMode(false);
    setSearchTotal(0);
    void fetchList(0, { q: "" });
  }

  useEffect(() => {
    loadBrowse();
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      const res = await searchArticles(query.trim(), chip === "all" ? undefined : chip);
      const articles = res.data?.articles ?? [];
      setItems(
        articles.map((article: any, index: number) => ({
          page_id: `hit-${index}`,
          title: article.title ?? "",
          domain: article.domain ?? chip,
          source_url: article.source_url ?? "",
          updated_by: null,
          last_synced: null,
        }))
      );
      setSearchMode(true);
      setSearchTotal(articles.length);
      setListMeta({ offset: 0, returned: articles.length, total: articles.length });
      setPage(1);
      onToast(`${articles.length} search results found`);
    } catch {
      onToast("Search failed", "err");
    } finally {
      setBusy(false);
    }
  }

  /* The sync is queued server-side and takes ~90s; the request returns immediately. The
     old code awaited the whole run, so the proxy timed out first and the page said
     "Sync failed" while the sync was still going. Watch the run state instead. */
  async function handleSync() {
    setBusy(true);
    try {
      const res = await triggerSync();
      if (res.status === 409) {
        onToast(res.data?.detail ?? "A sync is already running");
      } else if (res.status >= 400) {
        throw new Error(res.data?.detail ?? `Sync could not start (HTTP ${res.status})`);
      } else {
        onToast("Sync started — this usually takes about a minute");
      }

      for (let i = 0; i < 60; i += 1) {
        const st = await getSyncStatus().catch(() => null);
        if (st) {
          if (st.state === "error") throw new Error(st.run_error || "Sync failed");
          if (st.state === "done") {
            onToast(`Knowledge base synced · ${st.last_run?.pages ?? st.pages} page(s)`);
            await loadBrowse();
            setSearchMode(false);
            await fetchList(0);
            return;
          }
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      onToast("Sync is still running — the status strip will update when it finishes");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Sync failed", "err");
    } finally {
      setBusy(false);
    }
  }

  /** Browse chips, deduped by the LABEL the user sees: an article-domain key and a
   *  classifier key can resolve to the same display name ("General IT"), which used to
   *  render twice with different counts. The variant that owns articles wins. */
  const chips = useMemo(() => {
    const labelOf = (k: string) => metaFor(k).label.toLowerCase();
    const countOf = (k: string) =>
      domains?.find((d) => d.domain === k)?.pages ?? domainCardMap.get(k)?.pages ?? 0;
    const list: string[] = ["all"];
    const seen = new Set<string>(["all domains"]);
    const add = (key: string) => {
      const label = labelOf(key);
      if (!seen.has(label)) {
        seen.add(label);
        list.push(key);
        return;
      }
      const existing = list.find((k) => k !== "all" && labelOf(k) === label);
      if (existing && countOf(existing) === 0 && countOf(key) > 0) {
        list[list.indexOf(existing)] = key;
      }
    };
    domains?.forEach((d) => add(d.domain));
    classifierDomains.forEach((d: ClassifierDomainItem) => add(d.domain_key));
    return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domains, classifierDomains, domainCardMap]);

  /** Reset every control that narrows the list, and reload from the top. */
  function resetAll() {
    setProviderFilter("all");
    setChip("all");
    setQuery("");
    setSearchMode(false);
    setSearchTotal(0);
    // The filter effect refetches when these land; an explicit call keeps the reset
    // instant even when the values were already "all".
    void fetchList(0, { domain: "all", q: "", provider: "all" });
  }

  const lastSync = relDuration(status?.last_run?.at);
  const total = searchMode ? searchTotal : kbTotal ?? items?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil((kbTotal ?? 0) / pageSize));
  const rangeStart = listMeta ? listMeta.offset + 1 : 0;
  const rangeEnd = listMeta ? listMeta.offset + listMeta.returned : 0;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={["Workspace", "Knowledge"]}
        eyebrow="Administration"
        icon={<BookOpen className="size-5" />}
        badge={role === "admin" ? "Administrator" : role === "knowledge" ? "Knowledge Manager" : "User"}
        title="Knowledge base"
        description="Keep your assistant's knowledge organized, searchable, and up to date."
        actions={
          <div className="flex items-center gap-3">
            {/* Small live indicator — the same two states the page always reported. */}
            <div
              className={[
                "hidden items-center gap-2 rounded-xl border px-3 py-1.5 text-xs sm:flex",
                status?.healthy
                  ? "border-[var(--ok)]/35 bg-[var(--ok)]/10"
                  : "border-[var(--warn)]/35 bg-[var(--warn)]/10",
              ].join(" ")}
            >
              <span
                className={[
                  "size-2 rounded-full",
                  status?.healthy ? "bg-[var(--ok)]" : "bg-[var(--warn)]",
                ].join(" ")}
              />
              <span className="font-semibold text-foreground">
                {status?.healthy ? "KB Synced" : "Sync Pending"}
              </span>
              <span className="text-xs text-muted-foreground">
                {status?.last_run ? `(${relTime(status.last_run.at)})` : ""}
              </span>
            </div>

            {/* Primary: syncing is the page's one "do something" action. */}
            <button
              type="button"
              disabled={busy}
              onClick={handleSync}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              <RefreshCw className={["size-3.5", busy ? "animate-spin" : ""].join(" ")} />
              Sync now
            </button>
          </div>
        }
      />

      <main className="space-y-5">
        {/* FOUR EQUAL FIGURES
            Each value is counted from a value the page already holds: the KB size from
            the API's COUNT(*), the domain count from the domain list, the source count
            from the provider table, and the sync age from /sync-status. */}
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={<BookOpen className="size-4" />}
            label="Articles"
            value={kbTotal != null ? kbTotal.toLocaleString() : "—"}
            caption="In your knowledge base"
          />
          <StatCard
            icon={<Layers className="size-4" />}
            label="Domains"
            value={domains ? domains.length.toLocaleString() : "—"}
            caption="Organized by expertise"
          />
          <StatCard
            icon={<Database className="size-4" />}
            label="Sources"
            value={sources != null ? sources.length.toLocaleString() : "—"}
            caption="With indexed articles"
          />
          <StatCard
            icon={<Clock3 className="size-4" />}
            label="Last sync"
            value={status?.state === "running" ? "Syncing" : lastSync.value}
            suffix={status?.state === "running" ? "…" : lastSync.suffix}
            caption={
              status?.state === "running"
                ? `Started by ${status.started_by ?? "scheduler"}`
                : status?.state === "error"
                  ? "Last run failed — see the Sync button"
                  : `Runs every ${status?.beat_interval_minutes ?? 30} min`
            }
          />
        </section>

        {/* REVIEW BAND
            P1#10 — surface the articles no domain claimed. After the LLM pass this is
            small, but it is exactly the set that silently goes missing from every domain
            browse view. Domains with no description cannot be chosen by the classifier
            either, so both are reported here. Rendered ONLY when the data supports it. */}
        {!listing && items && (() => {
          const apiGen = domains?.find((d) => d.domain === "general")?.pages;
          const gen = typeof apiGen === "number" ? apiGen : (domainCardMap.get("general")?.pages ?? 0);
          const noDesc = (domains ?? []).filter((d) => !d.description || d.description.trim().length < 25);
          if (gen === 0 && noDesc.length === 0) return null;
          return (
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border border-[var(--warn)]/35 bg-[var(--warn)]/10 px-4 py-3 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warn)]" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--warn)]">
                  Needs review
                </div>
                <p className="mt-0.5 font-semibold">
                  {gen > 0
                    ? `${gen} article${gen === 1 ? "" : "s"} sit in General IT`
                    : "Some domains are not usable by the classifier"}
                </p>
                <p className="mt-0.5 leading-relaxed">
                  {gen > 0 && (
                    <>
                      General IT is the fallback bucket: the classifier cannot route these
                      by domain, so they are matched by keyword only and can surface for the
                      wrong question. Articles that genuinely belong there (contacts,
                      escalation guides, “Start Here”) can stay.
                    </>
                  )}
                  {gen > 0 && noDesc.length > 0 && " "}
                  {noDesc.length > 0 && (
                    <>{noDesc.length} domain{noDesc.length === 1 ? "" : "s"} have no description — the classifier cannot choose them at all.</>
                  )}
                </p>
              </div>
              {gen > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setChip("general");
                    setPage(1);
                    void fetchList(0, { domain: "general" });
                    chipsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
                  }}
                  className="shrink-0 rounded-lg border border-[var(--warn)]/40 bg-card px-3 py-1.5 font-medium transition hover:bg-muted"
                >
                  Review General IT →
                </button>
              )}
            </div>
          );
        })()}

        {/* P3c — LLM re-classification audit. Gated on manage_domains, since this changes
            domain assignment (the same capability as the Domains & Routing engine). */}
        {canManageDomains && (
          <ReclassifyPanel onApplied={() => { void fetchList((page - 1) * pageSize); void loadBrowse(); }} />
        )}

        {/* THE PANEL — heading, toolbar, domain chips, bulk bar, table and footer all live
            in one surface so the whole article library reads as a single unit. */}
        <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-card shadow-xs">
          {/* 1. heading row: h2 + count badge, right-aligned muted note */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
            <h2 className="text-sm font-semibold text-foreground">
              Article library
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {total}
              </span>
            </h2>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              Sorted by {SORT_LABELS[sortKey]}
              {sortDir === "desc" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            </span>
          </div>

          {/* Result count is a live region so a filter change is announced, not silent. */}
          <p role="status" aria-live="polite" className="px-5 pb-3 pt-1 text-xs text-muted-foreground">
            {listing ? (
              "Loading articles…"
            ) : listError ? (
              "Could not load articles"
            ) : (
              <>
                <span className="font-semibold text-foreground">{total}</span>{" "}
                article{total === 1 ? "" : "s"}
                {hasFilters ? " matching the current filters" : " in the knowledge base"}
              </>
            )}
          </p>

          {/* 2. toolbar: search (flex 1) + source + sort + Reset */}
          <div className="flex flex-wrap items-center gap-2.5 border-y border-[var(--border)] px-5 py-4">
            <form onSubmit={handleSearch} className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search solutions, errors, procedures…"
                  aria-label="Search the knowledge base"
                  className="h-9 w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-3 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
                />
              </div>

              <select
                value={qField}
                onChange={(e) => setQField(e.target.value as "all" | "title" | "body")}
                title="Where to look for the search text"
                aria-label="Search field"
                className="hidden h-9 shrink-0 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)] sm:block"
              >
                <option value="all">Title + body</option>
                <option value="title">Title only</option>
                <option value="body">Body only</option>
              </select>

              <Button type="submit" size="sm" disabled={busy || !query.trim()} className="h-9 w-full rounded-lg px-4 text-xs sm:w-auto">
                Search
              </Button>
            </form>

            {/* Source was a second chip band. It is a refinement, not a browse axis, so a
                select communicates the same thing in one row. */}
            <select
              value={providerFilter}
              onChange={(e) => { setProviderFilter(e.target.value); setSearchMode(false); setPage(1); }}
              title="Filter by knowledge source"
              aria-label="Filter by knowledge source"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)] sm:flex-none"
            >
              <option value="all">All sources</option>
              {(sources ?? []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>

            {/* Sorting is server-side: the select re-sorts the whole KB, not the loaded page. */}
            <select
              value={`${sortKey}:${sortDir}`}
              onChange={(e) => {
                const [k, d] = e.target.value.split(":") as [typeof sortKey, "asc" | "desc"];
                setSortKey(k);
                setSortDir(d);
                setSearchMode(false);
                setPage(1);
              }}
              title="Sort order"
              aria-label="Sort order"
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none transition focus:border-[var(--primary)] sm:flex-none"
            >
              <option value="last_synced:desc">Recently synced</option>
              <option value="last_synced:asc">Oldest synced</option>
              <option value="title:asc">Title A–Z</option>
              <option value="title:desc">Title Z–A</option>
              <option value="domain:asc">Domain A–Z</option>
              <option value="domain:desc">Domain Z–A</option>
            </select>

            <button
              type="button"
              onClick={resetAll}
              disabled={!hasFilters}
              className="h-9 shrink-0 rounded-lg border border-[var(--border)] bg-card px-3.5 text-xs font-semibold transition hover:bg-muted disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          {/* 3. domain chips — the primary browse axis, with real per-domain counts. */}
          <div
            ref={chipsRef}
            className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--border)] px-5 py-3 [scrollbar-width:thin]"
          >
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            {chips.map((domain) => {
              const active = domain === chip;
              const meta = domain === "all" ? null : metaFor(domain);
              const label = domain === "all" ? "All domains" : meta!.label;
              const apiCount = domains?.find((d) => d.domain === domain)?.pages;
              const count = domain === "all"
                ? (kbTotal ?? items?.length)
                : (typeof apiCount === "number" ? apiCount : domainCardMap.get(domain)?.pages);
              const desc = meta?.description;
              return (
                <button
                  key={domain}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setChip(domain);
                    setSearchMode(false);
                    setPage(1);
                  }}
                  /* P0#1 — the per-domain colour and wording come from the DB, so a
                     domain whose display_name is wrong is visible at a glance instead
                     of silently reading like its neighbour. */
                  title={desc ? `${label} — ${desc}` : label}
                  className={[
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
                    active
                      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                      : "border-[var(--border)] bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  ].join(" ")}
                >
                  {meta && <meta.icon className={`size-3 ${active ? "text-[var(--primary-foreground)]" : meta.iconClass}`} />}
                  {label}
                  {typeof count === "number" && (
                    <span className={active ? "text-[var(--primary-foreground)]/70" : "text-muted-foreground"}>{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* One summary of what is narrowing the list, with one way out. The old layout
              offered "Clear filters" only inside the source band, so a user who had
              filtered by domain had no visible way to reset it. */}
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-5 py-2.5 text-xs">
              <span className="text-muted-foreground">Filtered by</span>
              {query.trim() && <FilterPill label={`"${query.trim()}"`} onClear={clearSearch} />}
              {chip !== "all" && <FilterPill label={metaFor(chip).label} onClear={() => setChip("all")} />}
              {providerFilter !== "all" && (
                <FilterPill label={(sources ?? []).find((p) => p.key === providerFilter)?.label ?? providerFilter} onClear={() => setProviderFilter("all")} />
              )}
              <button
                type="button"
                onClick={resetAll}
                className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
              >
                <X className="size-3" /> Clear all
              </button>
            </div>
          )}

          {/* 5. the table — scrolls horizontally on narrow screens. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-0 text-xs md:min-w-[720px]">
              {/* Sticky: the list is long and paging scrolls the header out of view, so the
                  column names — and the sort control inside them — have to stay reachable. */}
              <thead className="sticky top-0 z-10 border-b border-[var(--border)] bg-muted/60 backdrop-blur-sm">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {([
                    { k: "title", l: "Article title", cls: "px-5 py-3.5 font-semibold" },
                    { k: null, l: "Source", cls: "hidden px-4 py-3.5 font-semibold md:table-cell" },
                    { k: "domain", l: "Domain", cls: "px-4 py-3.5 font-semibold" },
                    { k: "last_synced", l: "Last sync", cls: "hidden px-4 py-3.5 font-semibold lg:table-cell" },
                  ] as const).map((h) => (
                    <th key={h.l} className={h.cls}>
                      {h.k ? (
                        /* Sorting is server-side: clicking sorts the whole KB,
                           not just the rows currently loaded. */
                        <button
                          type="button"
                          onClick={() => {
                            const nextDir = sortKey === h.k && sortDir === "desc" ? "asc" : "desc";
                            setSortKey(h.k as typeof sortKey);
                            setSortDir(nextDir);
                            setSearchMode(false);
                            setPage(1);
                          }}
                          className="inline-flex items-center gap-1 transition hover:text-foreground"
                          aria-label={`Sort by ${h.l}`}
                          title={`Sort by ${h.l}`}
                        >
                          {h.l}
                          {sortKey === h.k ? (
                            sortDir === "desc" ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-30" />
                          )}
                        </button>
                      ) : (
                        h.l
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listing ? (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <Skeleton className="h-9 w-full rounded-lg" />
                    </td>
                  </tr>
                ) : listError ? (
                  <tr>
                    <td colSpan={5}>
                      <ErrorState
                        compact
                        title="Could not load the knowledge base"
                        detail={listError}
                        onRetry={() => void fetchList((page - 1) * pageSize)}
                      />
                    </td>
                  </tr>
                ) : !items || items.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {/* "Nothing here yet" and "nothing matches" need different words:
                          only the second is something the user caused and can undo, so
                          only it gets the clear-filters action. */}
                      {(kbTotal ?? 0) === 0 && !query && chip === "all" && providerFilter === "all" ? (
                        <EmptyState
                          icon={<BookOpen className="size-5" />}
                          title="No articles yet"
                          description="Articles arrive from your knowledge sources and from the sync jobs. Connect a source in Settings → Integrations, or create one manually."
                        />
                      ) : (
                        <EmptyState
                          icon={<SearchX className="size-5" />}
                          title="No articles match this filter"
                          description={kbTotal && kbTotal > 0 ? `${kbTotal} article${kbTotal === 1 ? "" : "s"} in the knowledge base, but none match the current filters.` : "No articles match the current filters."}
                          actionLabel="Clear filters"
                          onAction={() => { resetAll(); }}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  items.map((article) => {
                    const meta = metaFor(article.domain);
                    return (
                      <tr
                        key={article.page_id}
                        className="border-t border-[var(--border)]/60 transition hover:bg-muted/40"
                      >
                        {/* Was `truncate` on a fixed max-width, which cut long article
                            titles with no way to read the rest. Two lines, then ellipsis,
                            plus the full text in the tooltip. The cell is a button now:
                            it opens the row's details dialog. */}
                        <td className="max-w-[400px] px-5 py-3">
                          <button
                            type="button"
                            onClick={() => setDetail(article)}
                            title={article.title}
                            className="block max-w-full text-left font-medium text-foreground underline-offset-2 transition hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                          >
                            <span className="line-clamp-2">
                              {/* P1#8 — show WHERE the search text matched so the
                                  result does not look arbitrary. */}
                              {query.trim() ? highlight(article.title, query) : article.title}
                            </span>
                          </button>
                        </td>
                        <td className="hidden px-4 py-3 md:table-cell">
                          {/* The badge IS the link to the source. Previously a separate
                              "Actions" column held a lone external-link icon pointing at
                              the same URL. */}
                          {article.source_url ? (
                            <a
                              href={article.source_url}
                              target="_blank"
                              rel="noreferrer"
                              title={`Open source: ${article.source_url}`}
                              className="inline-flex items-center gap-1 rounded-md transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                            >
                              <Badge variant="outline" className={`text-xs ${providerOf(article).className}`}>
                                {providerOf(article).key === "unknown" ? "Internal" : providerOf(article).label}
                              </Badge>
                              <ExternalLink className="size-2.5 text-muted-foreground" />
                            </a>
                          ) : (
                            <Badge variant="outline" className={`text-xs ${providerOf(article).className}`}>
                              {providerOf(article).label}
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs ${meta.bgClass} ${meta.iconClass}`}>
                            {meta.label}
                          </Badge>
                        </td>
                        <td
                          className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell"
                          title={article.last_synced ? new Date(article.last_synced).toLocaleString() : "never synced"}
                        >
                          {relTime(article.last_synced)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 6. footer — the range comes from what the SERVER returned, and the pager
              offers real page numbers. In relevance-search mode the hits are not a slice
              of the KB, so paging would be a lie: it shows the match count instead. */}
          {searchMode ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5">
              <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                {searchTotal === 0 ? (
                  <>No matches{query.trim() ? <> for “{query.trim()}”</> : null}</>
                ) : (
                  <>
                    Showing <span className="font-semibold text-foreground">1–{items?.length ?? 0}</span> of{" "}
                    <span className="font-semibold text-foreground">{searchTotal}</span> best match{searchTotal === 1 ? "" : "es"}
                    {query.trim() ? <> for “{query.trim()}”</> : null}
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                <X className="size-3.5" /> Clear search
              </button>
            </div>
          ) : kbTotal != null && kbTotal > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3.5">
              <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
                Showing <span className="font-semibold text-foreground">{rangeStart}–{rangeEnd}</span> of{" "}
                <span className="font-semibold text-foreground">{kbTotal.toLocaleString()}</span>
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-muted-foreground">
                  {pageSize} / page
                </span>

                <nav aria-label="Pagination" className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={page <= 1 || listing}
                    onClick={() => goToPage(page - 1)}
                    className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-muted-foreground/40"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>

                  {pageWindow(page, totalPages).map((n, i) =>
                    n === "gap" ? (
                      <span key={`gap-${i}`} aria-hidden className="px-1 text-xs text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={n}
                        type="button"
                        aria-label={`Page ${n}`}
                        aria-current={n === page ? "page" : undefined}
                        disabled={listing}
                        onClick={() => goToPage(n)}
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
                    disabled={page >= totalPages || listing}
                    onClick={() => goToPage(page + 1)}
                    className="grid size-8 place-items-center rounded-lg border border-[var(--border)] bg-card transition hover:bg-muted disabled:cursor-not-allowed disabled:border-transparent disabled:bg-muted disabled:text-muted-foreground/40"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                </nav>
              </div>
            </div>
          ) : null}
        </section>

        {/* Where the numbers above come from. Stated plainly so a count is never read as a
            guess: the total is the API's COUNT(*), not the rows on this page. */}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Counts are read from the Knowledge Base Articles index — the total is a COUNT(*)
          over the whole filtered set, not just the rows on this page. Domain counts come
          from each domain's article list, and the source options come from the connected
          content providers.
        </p>
      </main>

      {/* Details dialog — the title cell opens it. It shows only the fields the list row
          already carries, so nothing here is invented. */}
      {detail && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Article details: ${detail.title}`}
          onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-card p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">{detail.title}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setDetail(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="size-4" />
              </button>
            </div>

            <dl className="mt-4 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Domain</dt>
                <dd>
                  <Badge variant="outline" className={`text-xs ${metaFor(detail.domain).bgClass} ${metaFor(detail.domain).iconClass}`}>
                    {metaFor(detail.domain).label}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Source</dt>
                <dd>
                  <Badge variant="outline" className={`text-xs ${providerOf(detail).className}`}>
                    {providerOf(detail).label}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Last sync</dt>
                <dd className="text-foreground">
                  {detail.last_synced
                    ? `${relTime(detail.last_synced)} · ${new Date(detail.last_synced).toLocaleString()}`
                    : "never"}
                </dd>
              </div>
              {detail.updated_by && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Updated by</dt>
                  <dd className="text-foreground">{detail.updated_by}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Page ID</dt>
                <dd className="font-mono text-xs text-foreground">{detail.page_id}</dd>
              </div>
            </dl>

            {detail.source_url && (
              <a
                href={detail.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
              >
                Open source <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
