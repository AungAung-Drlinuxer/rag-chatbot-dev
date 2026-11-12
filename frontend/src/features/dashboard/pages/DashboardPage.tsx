import { Activity, CalendarDays, ChevronDown, GripHorizontal, Home, LayoutGrid, RefreshCw, RotateCcw, Save } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";

import { useEffect, useMemo, useState } from "react";

import {
  dashStats,
  dashConversations,
  dashDomains,
  dashRecentConversations,
  dashRecentTickets,
  dashHealth,
  dashGateTrend,
  type ReportWindow,
} from "@/features/dashboard/api";

import { Button } from "@/components/ui/button";

import type { Conversation, RecentTicket, Domain, HealthItem } from "@/features/dashboard/lib/dashboardTypes";
import { healthIcon } from "@/features/dashboard/lib/dashboardUtils";
import {
  getGuardrailEvents,
  getObservabilityOverview,
  type GuardrailEvent,
  type ObservabilityOverview,
} from "@/features/observability/api";
import { DashboardReportButtons } from "@/features/dashboard/components/DashboardBits";

import {
  DashboardDataProvider,
  type DashboardData,
  type GatePoint,
  type SeriesPoint,
} from "@/features/dashboard/panels/data";
import { renderPanelBody } from "@/features/dashboard/panels/PanelBodies";
import {
  layoutFor,
  panelTitle,
  type PanelSpec,
} from "@/features/dashboard/panels/types";
import { useGridLayout } from "@/features/dashboard/lib/useGridLayout";
import { GRID_COLS, GRID_GAP, GRID_ROW_HEIGHT, layoutItems } from "@/features/dashboard/lib/gridLayout";
import GridLayoutBase, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

/**
 * Which edges of a panel can be dragged.
 *
 * `["w", "e"]` trades width between neighbours inside a band — the common case, and the one
 * that keeps every band full. The full ring `["n", "s", "e", "w", "ne", "nw", "se", "sw"]`
 * also trades height, which is a band property: dragging one panel's south edge grows its
 * band and shrinks the band below, so the panels sharing that band move together. Both are
 * one-line changes; nothing else in the board needs to know which is in use.
 */

/**
 * Overview — the board the rest of the app hangs off.
 *
 * It is a fixed, curated page, not an arranger: the same PageHeader → rows rhythm as
 * Knowledge, Tickets, Users and Domains, with full-width rows for the things you scan
 * (attention, KPIs) and halves for the things you compare (trend vs outcome, tokens vs cost).
 * There is no Customize mode — a board nobody has to arrange is one that is useful on the
 * first visit, and every deployment gets the same honest reading.
 *
 * The admin board adds the usage panels (tokens, spend, guardrail events); every other role
 * gets the operational board. Panel *heights* are per type, so a chart is drawn into the box
 * it needs rather than into whatever a user last dragged it to.
 *
 * WHAT DID NOT CHANGE: the /api/dashboard* endpoints remain the only source of figures, the
 * reporting-window picker governs every series, and a failed load renders "—" plus a banner —
 * a panel must never invent a zero. Every panel reads one shared data object, so twelve
 * panels cost the same seven requests.
 */

type Props = {
  userName?: string;
  role?: string;
  /** Capability map from the shell: cost is gated by the same cap as the Audit log. */
  perms?: Record<string, boolean> | null;
};

const BoardGridLayout = WidthProvider(GridLayoutBase);

/**
 * The board itself: a 12-column grid where every panel is a rectangle the user owns.
 *
 * Drag/resize are live only while `editing` is on (the "Edit layout" button), and a drag
 * starts from the header grip rather than anywhere on the card — so clicking a chart or a
 * table row never nudges the layout by accident.
 */
/** Desktop is where a grid makes sense; below lg the board stacks like every other page. */
function useIsDesktop() {
  const query = "(min-width: 1024px)";
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

function BoardGrid({
  panels,
  rects,
  editing,
  onLayoutChange,
}: {
  panels: readonly PanelSpec[];
  rects: Parameters<typeof layoutItems>[1];
  editing: boolean;
  onLayoutChange: (layout: Layout[]) => void;
}) {
  const desktop = useIsDesktop();

  /* A 12-column grid at 390px gives 79px panels. Below lg the board is one column of
     content-sized cards — the arrangement still applies on the screen it was made for. */
  if (!desktop) {
    return (
      <div className="flex flex-col gap-2">
        {panels.map((panel) => (
          <div key={panel.id} data-panel={panel.type} className="flex min-w-0 flex-col">
            <div
              data-panel-body
              className={panel.type === "kpis" ? "w-full" : "panel-surface rounded-xl"}
            >
              {renderPanelBody(panel, panelTitle(panel))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <BoardGridLayout
      className="board-grid"
      layout={layoutItems(panels, rects)}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={[GRID_GAP, GRID_GAP]}
      containerPadding={[0, 0]}
      isDraggable={editing}
      isResizable={editing}
      draggableHandle="[data-drag-handle]"
      draggableCancel=".no-drag"
      resizeHandles={["se", "sw", "ne", "nw", "e", "w", "s", "n"]}
      compactType="vertical"
      onLayoutChange={onLayoutChange}
      useCSSTransforms
    >
      {panels.map((panel) => (
        <div key={panel.id} data-panel={panel.type} className="flex min-w-0 flex-col">
          {editing && (
            <span
              data-drag-handle
              className="mb-1 flex cursor-grab items-center gap-1 self-start rounded-md border border-dashed border-[var(--primary)]/40 bg-[var(--primary)]/5 px-1.5 py-0.5 text-3xs font-medium uppercase tracking-wide text-[var(--accent-foreground)] active:cursor-grabbing"
              title="Drag to move this panel"
            >
              <GripHorizontal className="size-3" />
              {panelTitle(panel)}
            </span>
          )}
          <div
            data-panel-body
            className={
              panel.type === "kpis"
                ? "min-h-0 flex-1 overflow-auto"
                : "panel-surface min-h-0 flex-1 overflow-auto rounded-xl"
            }
          >
            {renderPanelBody(panel, panelTitle(panel))}
          </div>
        </div>
      ))}
    </BoardGridLayout>
  );
}

export default function Dashboard({ role, perms }: Props) {
  const canSeeUsage = role === "admin" || !!(perms && perms.manage_users);
  // The board means two different things depending on the caller: an administrator or a
  // Knowledge Manager reads the whole organization, everyone else reads their own trail.
  // The copy has to say which, or a plain user is told they are looking at "who it helped".
  const orgWide = canSeeUsage || role === "knowledge" || role === "domain_manager";
  const roleBadge = role === "admin" ? "Administrator"
    : role === "knowledge" || role === "domain_manager" ? "Knowledge Manager"
    : "User";
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  // The COMMITTED reporting window is the state. The picker's controls are only ways to
  // set it, so opening the picker — or typing half a range — cannot change what is reported.
  const [win, setWin] = useState<ReportWindow>({ kind: "preset", days: 7 });
  // The date boxes hold a DRAFT; "Apply range" commits it into `win`.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  // What the backend actually reported, so the footer names the real window rather than
  // repeating the request (the backend clamps a span it considers too long).
  const [windowEcho, setWindowEcho] = useState<{ start: string; end: string } | null>(null);

  // Real API data
  const [stats, setStats] = useState<any>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [domainsLive, setDomainsLive] = useState<Domain[]>([]);
  const [liveConversations, setLiveConversations] = useState<Conversation[]>([]);
  const [liveTickets, setLiveTickets] = useState<RecentTicket[]>([]);
  const [liveHealth, setLiveHealth] = useState<HealthItem[]>([]);
  const [gateTrend, setGateTrend] = useState<GatePoint[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const [usage, setUsage] = useState<ObservabilityOverview | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageDenied, setUsageDenied] = useState(false);
  const [guardrailEvents, setGuardrailEvents] = useState<GuardrailEvent[]>([]);
  const [guardrailDenied, setGuardrailDenied] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [healthSummary, setHealthSummary] = useState<{
    overall: string;
    down: string[];
    guardrailEvents: number;
  }>({ overall: "Healthy", down: [], guardrailEvents: 0 });

  // The board is fixed. It is curated per role and positioned by the product, not the user:
  // the admin board adds the usage panels, everyone else gets the operational ones.
  const panels: PanelSpec[] = useMemo(() => layoutFor(role), [role]);
  // Placement + band heights. Persisted per role, so an admin and an agent can each keep
  // their own arrangement in the same browser.
  const board = useGridLayout(panels, role);
  // Inline confirmation for the layout actions: the page has no toast host, and a button that
  // simply disappears is easy to miss.
  const [viewNote, setViewNote] = useState<string | null>(null);
  const flash = (msg: string) => {
    setViewNote(msg);
    window.setTimeout(() => setViewNote((cur) => (cur === msg ? null : cur)), 3200);
  };

  // Poll every 60s so a dashboard left open does not show stale figures.
  const [nowTick, setNowTick] = useState(0);
  void nowTick;
  useEffect(() => {
    const id = window.setInterval(() => {
      setRefreshTick((v) => v + 1);
      setNowTick((v) => v + 1);
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((v) => v + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
    });

  const rangeLabel =
    win.kind === "custom"
      ? `${shortDate(win.start)} → ${shortDate(win.end)}`
      : `Last ${win.days} days`;

  const todayIso = new Date().toISOString().slice(0, 10);
  const customInvalid = !!customFrom && !!customTo && (customFrom > customTo || customFrom > todayIso);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoadError(null);
      try {
        const [s, c, d, rc, rt, h, g] = await Promise.all([
          dashStats(),
          dashConversations(win),
          dashDomains(),
          dashRecentConversations(6),
          dashRecentTickets(5),
          dashHealth(),
          dashGateTrend(win),
        ]);
        if (!mounted) return;
        setStats(s ?? null);
        if (g?.series?.length) setGateTrend(g.series);
        else setGateTrend([]);
        if (c?.series?.length) setSeries(c.series);
        else setSeries([]);
        if (c?.start && c?.end) setWindowEcho({ start: c.start, end: c.end });
        setDomainsLive(
          d?.domains?.length
            ? d.domains.map((x: { name: string; count: number; percentage: number }) => ({
                name: x.name, count: x.count, percentage: x.percentage,
              }))
            : [],
        );
        setLiveConversations(rc?.conversations ?? []);
        if (rt?.tickets?.length) {
          const norm = (s: string) => {
            const v = (s || "").toLowerCase();
            if (v === "created" || v === "open") return "Open";
            if (v === "pending" || v === "in progress") return "Pending";
            if (v === "resolved" || v === "done" || v === "closed") return "Resolved";
            return "Open";
          };
          const prio = (s: string) => {
            const v = (s || "").toLowerCase();
            return v.charAt(0).toUpperCase() + v.slice(1);
          };
          setLiveTickets(rt.tickets.map((t: any) => ({ ...t, status: norm(t.status), priority: prio(t.priority) })));
        } else {
          setLiveTickets([]);
        }
        if (h?.services?.length) {
          setLiveHealth(h.services.map((x: any) => ({
            key: x.key,
            name: x.name,
            status: (x.status === "Healthy" ? "Healthy" : "Down") as HealthItem["status"],
            detail: x.detail ?? null,
            latency_ms: x.latency_ms ?? null,
            icon: healthIcon(x.key),
          })));
          setHealthSummary({
            overall: h.overall ?? "Healthy",
            down: h.down ?? [],
            guardrailEvents: h.security?.guardrail_events_7d ?? 0,
          });
        } else {
          setLiveHealth([]);
        }

        // Usage panels share this load, so merging the Observability page into the board did
        // not add a request per panel. Non-admins never call it: the endpoint refuses them.
        if (canSeeUsage) {
          try {
            const range = win.kind === "custom" ? { start: win.start, end: win.end } : { days: win.days };
            const [ov, ev] = await Promise.all([
              getObservabilityOverview(range),
              getGuardrailEvents(10).catch(() => null),
            ]);
            if (!mounted) return;
            setUsage(ov);
            setUsageError(null);
            setUsageDenied(false);
            if (ev) {
              setGuardrailEvents(ev.events);
              setGuardrailDenied(false);
            } else {
              setGuardrailEvents([]);
              setGuardrailDenied(true);
            }
          } catch (err) {
            if (!mounted) return;
            const msg = err instanceof Error ? err.message : String(err);
            setUsage(null);
            // Only a refusal is "you may not see this"; anything else is a failure to load,
            // and telling an administrator they lack permission would be a lie.
            setUsageDenied(msg.includes("403"));
            setUsageError(msg);
          }
        }
      } catch (err) {
        // No sample fallbacks: a failure surfaces as a banner plus "—" values, never zeroes.
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (mounted) {
          setLoading(false);
          setLastUpdated(new Date());
        }
      }
    }

    load();
    return () => { mounted = false; };
  }, [refreshTick, win, canSeeUsage]);

  function refreshDashboard() {
    setLoading(true);
    setLastUpdated(new Date());
    setRefreshTick((v) => v + 1);
  }

  // ---- derived, honest insight figures -------------------------------------------
  const totals = useMemo(() => {
    const total = Number(stats?.total_conversations ?? 0);
    const resolved = Number(stats?.resolved_by_bot ?? 0);
    const escalated = Number(stats?.escalated_to_tickets ?? 0);
    const unresolved = Math.max(0, total - resolved - escalated);
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0);
    const gateAnswered = gateTrend.reduce((a, d) => a + (d.answered ?? 0), 0);
    const gateCautioned = gateTrend.reduce((a, d) => a + (d.cautioned ?? 0), 0);
    const gateTotal = gateAnswered + gateCautioned;
    return {
      total, resolved, escalated, unresolved,
      resolvedPct: pct(resolved),
      escalatedPct: pct(escalated),
      unresolvedPct: pct(unresolved),
      gateAnswered, gateCautioned, gateTotal,
      gatePassPct: gateTotal > 0 ? Math.round((gateAnswered / gateTotal) * 1000) / 10 : null,
      openTickets: (liveTickets ?? []).filter((t) => t.status === "Open").length,
    };
  }, [stats, gateTrend, liveTickets]);

  const needsReview = useMemo(() => {
    // Escalated/unresolved first: the point of the list is what still needs a human.
    const rank = (c: Conversation) => {
      const r = (c.result || "").toLowerCase();
      if (r.includes("escalat")) return 0;
      if (r.includes("caution") || r.includes("unresolved") || r.includes("no answer")) return 1;
      return 2;
    };
    const all = [...(liveConversations ?? [])].sort((a, b) => rank(a) - rank(b));
    const flagged = all.filter((c) => rank(c) < 2);
    // Nothing flagged → show the latest conversations rather than an empty panel; the
    // point of the panel is triage, and a clean queue is worth showing, not hiding.
    return (flagged.length ? flagged : all).slice(0, 5);
  }, [liveConversations]);

  const attention = useMemo(() => {
    const items: { key: string; tone: "danger" | "warn" | "ok"; title: string; detail: string }[] = [];
    if (healthSummary.down.length) {
      items.push({
        key: "deps",
        tone: "danger",
        title: "Dependency down",
        detail: `Failing: ${healthSummary.down.join(", ")}`,
      });
    }
    if (totals.gatePassPct !== null && totals.gatePassPct < 85) {
      items.push({
        key: "gate",
        tone: "warn",
        title: "Low-confidence answers",
        detail: `${totals.gateCautioned} cautioned · ${totals.gatePassPct}% passed the gate`,
      });
    }
    return items;
  }, [healthSummary, totals]);

  function deltaInfo(key: string, current: number): {
    change: string | null; positive: boolean; description: string;
  } {
    const d = (stats as any)?.deltas?.[key];
    const prev = (stats as any)?.previous?.[key];
    if (d == null || prev == null) {
      return {
        change: null,
        positive: true,
        // No comparison data → say nothing rather than repeating "no baseline" on
        // every tile. Honest silence beats decorative captions.
        description: prev === 0 && current > 0 ? "new this week" : "",
      };
    }
    if (prev < 10) return { change: null, positive: d >= 0, description: `up from ${prev} last week` };
    if (Math.abs(d) >= 300) {
      const mult = prev > 0 ? current / prev : 0;
      return { change: null, positive: d >= 0, description: `${mult.toFixed(1)}× last week` };
    }
    return {
      change: `${d >= 0 ? "+" : "−"}${Math.abs(d)}%`,
      positive: d >= 0,
      description: "vs previous 7 days",
    };
  }
  const deltaProps = (key: string, current: number) => deltaInfo(key, current);

  const noActivity =
    !loading && !loadError && stats === null && series.length === 0
    && !liveTickets?.length && !liveConversations?.length;

  const healthDown = healthSummary.down;

  const data: DashboardData = {
    role, loading, loadError, stats, series, gateTrend,
    domains: domainsLive, conversations: liveConversations,
    tickets: liveTickets, health: liveHealth, healthSummary,
    totals, needsReview, attention, healthDown, win, rangeLabel, deltaProps,
    refresh: refreshDashboard,
    usage, usageError, usageDenied, guardrailEvents, guardrailDenied,
  };

  return (
    <PageShell>
      <div className="flex flex-col gap-2">
      <PageHeader
        breadcrumbs={["Workspace", "Overview"]}
        eyebrow="Workspace"
        icon={<Home className="size-5" />}
        badge={roleBadge}
        title="Overview"
        description={orgWide
          ? "What the assistant did, who it helped, and what still needs a human."
          : "Your conversations, the tickets you raised, and how the assistant answered you."}
        dense
        actions={<>
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setRangeOpen((v) => !v)}
              title="Reporting window"
              className={[
                "flex h-8 items-center gap-2 rounded-lg border border-[var(--border)] bg-card px-2.5 text-2xs font-medium shadow-sm transition hover:bg-muted",
                win.kind === "custom" ? "border-[var(--primary)]/50 text-[var(--accent-foreground)]" : "",
              ].join(" ")}
            >
              <CalendarDays className="size-3.5" />
              {rangeLabel}
              <ChevronDown className={`size-3 text-muted-foreground transition ${rangeOpen ? "rotate-180" : ""}`} />
            </button>
            {rangeOpen && (
              <div className="absolute right-0 top-11 z-20 w-64 rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-1.5 shadow-lg">
                {([7, 30, 90] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setWin((w) => (w.kind === "preset" && w.days === r ? w : { kind: "preset", days: r }));
                      setRangeOpen(false);
                    }}
                    className={[
                      "block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-muted",
                      win.kind === "preset" && win.days === r
                        ? "font-semibold text-[var(--accent-foreground)]"
                        : "text-foreground",
                    ].join(" ")}
                  >
                    Last {r} days
                  </button>
                ))}

                <div className="mt-1 border-t pt-1.5">
                  <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Custom range
                  </p>
                  <div className="space-y-2 px-3 pb-1 pt-1">
                    <label className="block">
                      <span className="text-2xs font-medium text-muted-foreground">From</span>
                      <input
                        type="date"
                        value={customFrom}
                        max={todayIso}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="mt-0.5 h-7 w-full rounded-md border border-[var(--border)] bg-card px-2 text-xs"
                      />
                    </label>
                    <label className="block">
                      <span className="text-2xs font-medium text-muted-foreground">To</span>
                      <input
                        type="date"
                        value={customTo}
                        max={todayIso}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="mt-0.5 h-7 w-full rounded-md border border-[var(--border)] bg-card px-2 text-xs"
                      />
                    </label>

                    {customInvalid && (
                      <p className="text-2xs leading-tight text-destructive">
                        {customFrom > todayIso
                          ? "Start date is in the future."
                          : "Start date must be on or before the end date."}
                      </p>
                    )}

                    <button
                      type="button"
                      disabled={!customFrom || !customTo || customInvalid}
                      onClick={() => {
                        setWin({ kind: "custom", start: customFrom, end: customTo });
                        setRangeOpen(false);
                      }}
                      className="h-7 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Apply range
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" className="rounded-lg" onClick={refreshDashboard}>
            <RefreshCw className={["mr-2 size-3.5", loading ? "animate-spin" : ""].join(" ")} />
            Refresh
          </Button>

          {viewNote && (
            <span role="status" className="text-2xs text-muted-foreground">{viewNote}</span>
          )}

          <Button
            variant={board.editing ? "default" : "outline"}
            size="sm"
            className="rounded-lg"
            onClick={() => board.setEditing(!board.editing)}
            title={board.editing
              ? "Stop moving panels around"
              : "Drag panels by their grip and resize them from any edge"}
            aria-pressed={board.editing}
          >
            <LayoutGrid className="mr-2 size-3.5" />
            {board.editing ? "Done editing" : "Edit layout"}
          </Button>

          {board.dirty && (
            <>
              <Button
                size="sm"
                className="rounded-lg"
                disabled={board.saving}
                onClick={() => {
                  board
                    .saveView()
                    .then(() => flash("View saved — it will open this way next time"))
                    .catch(() => flash("Could not save this view"));
                }}
                title="Keep this arrangement for your account"
              >
                <Save className="mr-2 size-3.5" />
                {board.saving ? "Saving…" : "Save view"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-lg"
                onClick={() => {
                  board
                    .reset()
                    .then(() => flash("Layout reset to the default view"))
                    .catch(() => flash("Could not reset the layout"));
                }}
                title="Put the panels back where they started"
              >
                <RotateCcw className="mr-2 size-3.5" />
                Reset layout
              </Button>
            </>
          )}

          <DashboardReportButtons
            stats={stats}
            conversations={liveConversations ?? []}
            tickets={liveTickets ?? []}
            domains={domainsLive ?? []}
          />

        </>}
      />

      <main className="flex flex-col gap-2">
        {loadError && !loading && (
          <ErrorState
            banner
            title="Some dashboard data could not be loaded"
            detail={loadError}
            onRetry={refreshDashboard}
            retryLabel="Retry"
          />
        )}

        {noActivity ? (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="No activity in this reporting window"
            description="Nothing has been recorded for the selected period. Try a wider range, or check that the chat and ticket integrations are connected in Settings."
            actionLabel="Widen to 90 days"
            onAction={() => setWin({ kind: "preset", days: 90 })}
          />
        ) : (
          <DashboardDataProvider value={data}>
            {/* Grafana-style board: every panel is a rectangle in a 12-column grid, moved by
                its grip and resized from any edge while "Edit layout" is on. Heights are the
                user's, so a panel shows its content by growing — the page scrolls, nothing is
                clipped to fit a screen. */}
            <BoardGrid
              panels={panels}
              rects={board.rects}
              editing={board.editing}
              onLayoutChange={board.onLayoutChange}
            />
          </DashboardDataProvider>
        )}
      </main>

      {/* ---------------- FOOTER ---------------- */}
      <div className="flex shrink-0 flex-col items-center justify-center gap-2 text-3xs text-muted-foreground sm:flex-row">
        <span title={windowEcho ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}` : rangeLabel}>
          {windowEcho ? `${shortDate(windowEcho.start)} → ${shortDate(windowEcho.end)}` : rangeLabel}
        </span>
        <span className="hidden sm:block">|</span>
        <span title={lastUpdated.toLocaleString()}>
          Last updated:{" "}
          {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          <span className="ml-1 opacity-70">
            ({(() => {
              const secs = Math.max(0, Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
              if (secs < 60) return `${secs}s ago`;
              const mins = Math.floor(secs / 60);
              return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
            })()})
          </span>
        </span>
        <span className="hidden sm:block">|</span>
        <span>{panels.length} panels · live data</span>
        <button
          type="button"
          onClick={refreshDashboard}
          title="Refresh now"
          aria-label="Refresh dashboard"
          className="rounded p-0.5 transition hover:text-[var(--accent-foreground)]"
        >
          <RefreshCw className={["size-3", loading ? "animate-spin" : ""].join(" ")} />
        </button>
      </div>

      </div>
    </PageShell>
  );
}
