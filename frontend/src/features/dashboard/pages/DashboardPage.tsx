import {
  Activity,
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
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
import { DashboardReportButtons } from "@/features/dashboard/components/DashboardBits";

import {
  DashboardDataProvider,
  type DashboardData,
  type GatePoint,
  type SeriesPoint,
} from "@/features/dashboard/panels/data";
import PanelFrame from "@/features/dashboard/panels/PanelFrame";
import PanelEditor from "@/features/dashboard/panels/PanelEditor";
import { renderPanelBody } from "@/features/dashboard/panels/PanelBodies";
import {
  getDashboardLayout,
  resetDashboardLayout,
  saveDashboardLayout,
} from "@/features/dashboard/panels/layoutApi";
import {
  DEFAULT_LAYOUT,
  MAX_SPAN,
  MIN_SPAN,
  newPanelId,
  panelTitle,
  type PanelSpec,
} from "@/features/dashboard/panels/types";

/**
 * Overview — a Grafana-style board of panels the operator arranges themselves.
 *
 * WHY PANELS INSTEAD OF A FIXED LAYOUT: the page used to decide, for every deployment, that
 * "needs attention" belonged above the KPI tiles and that system health belonged in a right
 * rail. An admin who only watches the knowledge base still scrolled past five panels, and a
 * team that runs no Jira had a permanently empty "recent tickets" box. The layout is now data
 * (`dashboard_layouts.panels`), editable in place: move, resize, rename, duplicate, delete,
 * add, and reset.
 *
 * WHAT DID NOT CHANGE: the seven /api/dashboard* endpoints remain the only source of figures,
 * the reporting-window picker still governs every series, and a failed load still renders "—"
 * plus a banner — a panel must never invent a zero. Every panel reads one shared data object,
 * so ten panels cost the same seven requests as one, and a panel is never the reason a
 * figure is missing.
 *
 * The panels themselves live in ./panels: `types.ts` is the catalogue, `PanelBodies.tsx` the
 * renderers, `PanelFrame.tsx` the chrome, `PanelEditor.tsx` the form, `layoutApi.ts` the
 * storage. This file owns the data load and the editing state machine.
 */

type Props = {
  userName?: string;
  role?: string;
};

export default function Dashboard({ role }: Props) {
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [healthSummary, setHealthSummary] = useState<{
    overall: string;
    down: string[];
    guardrailEvents: number;
  }>({ overall: "Healthy", down: [], guardrailEvents: 0 });

  // Layout: `layout` is what is saved, `draft` is what edit mode is manipulating.
  const [layout, setLayout] = useState<PanelSpec[]>(DEFAULT_LAYOUT);
  const [draft, setDraft] = useState<PanelSpec[]>(DEFAULT_LAYOUT);
  const [custom, setCustom] = useState(false);
  const [editing, setEditing] = useState(false);
  const [layoutLabel, setLayoutLabel] = useState("Default layout");
  const [layoutReady, setLayoutReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [layoutMsg, setLayoutMsg] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ index: number | null; panel: PanelSpec } | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);

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

  // ---- saved layout ---------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    getDashboardLayout()
      .then((saved) => {
        if (!alive) return;
        if (saved.custom && Array.isArray(saved.panels) && saved.panels.length) {
          setLayout(saved.panels as PanelSpec[]);
          setCustom(true);
          setLayoutLabel("Saved layout");
        }
      })
      .catch(() => {
        // No saved layout (or the endpoint is unreachable): the default board is the page.
        // A failure here must not block the dashboard itself.
      })
      .finally(() => { if (alive) setLayoutReady(true); });
    return () => { alive = false; };
  }, []);

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
  }, [refreshTick, win]);

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
  };

  // ---- layout editing ------------------------------------------------------------
  const panels = editing ? draft : layout;

  function beginEdit() {
    setDraft(layout.map((p) => ({ ...p, options: { ...p.options } })));
    setEditing(true);
    setLayoutMsg(null);
  }

  function cancelEdit() {
    setEditing(false);
    setLayoutMsg(null);
  }

  function movePanel(index: number, direction: -1 | 1) {
    const to = index + direction;
    if (to < 0 || to >= draft.length) return;
    const next = [...draft];
    [next[index], next[to]] = [next[to], next[index]];
    setDraft(next);
  }

  function dropOn(index: number) {
    if (dragFrom === null || dragFrom === index) {
      setDragFrom(null);
      return;
    }
    const next = [...draft];
    const [moved] = next.splice(dragFrom, 1);
    next.splice(index, 0, moved);
    setDragFrom(null);
    setDraft(next);
  }

  async function saveLayout() {
    setSaving(true);
    setLayoutMsg(null);
    try {
      const saved = await saveDashboardLayout(draft);
      setLayout(saved.panels as PanelSpec[]);
      setCustom(true);
      setLayoutLabel("Saved layout");
      setEditing(false);
      setLayoutMsg("Layout saved for your account.");
    } catch (err) {
      setLayoutMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function resetLayout() {
    setSaving(true);
    setLayoutMsg(null);
    try {
      await resetDashboardLayout();
      setLayout(DEFAULT_LAYOUT);
      setDraft(DEFAULT_LAYOUT);
      setCustom(false);
      setLayoutLabel("Default layout");
      setEditing(false);
      setLayoutMsg("Reset to the default layout.");
    } catch (err) {
      setLayoutMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const openNewPanel = () =>
    setEditor({ index: null, panel: { id: newPanelId(), type: "attention", title: "", span: 6, options: {} } });

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={["Workspace", "Overview"]}
        eyebrow="Workspace"
        icon={<LayoutDashboard className="size-5" />}
        badge={role === "admin" ? "Administrator" : "User"}
        title="Overview"
        description="What the assistant did, who it helped, and what still needs a human."
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

          <DashboardReportButtons
            stats={stats}
            conversations={liveConversations ?? []}
            tickets={liveTickets ?? []}
            domains={domainsLive ?? []}
          />

          {!editing ? (
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={beginEdit}
              disabled={!layoutReady}
              title="Move, resize, rename, add or remove panels"
            >
              <Pencil className="mr-2 size-3.5" /> Customize
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                <X className="mr-2 size-3.5" /> Cancel
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetLayout}
                disabled={saving || !custom}
                title={custom ? "Delete your saved layout and use the default board" : "Already the default layout"}
              >
                <RotateCcw className="mr-2 size-3.5" /> Reset
              </Button>
              <Button size="sm" onClick={saveLayout} disabled={saving}>
                <Save className="mr-2 size-3.5" /> {saving ? "Saving…" : "Save layout"}
              </Button>
            </>
          )}
        </>}
      />

      <main className="space-y-4">
        {loadError && !loading && (
          <ErrorState
            banner
            title="Some dashboard data could not be loaded"
            detail={loadError}
            onRetry={refreshDashboard}
            retryLabel="Retry"
          />
        )}

        {editing && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-2xs text-muted-foreground">
            <span className="font-medium text-foreground">Editing layout · {layoutLabel.toLowerCase()}</span>
            <button
              type="button"
              onClick={openNewPanel}
              className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-card px-2 py-1 font-medium text-foreground transition hover:bg-muted"
            >
              <Plus className="size-3" /> Add panel
            </button>
            <span className="hidden sm:inline">
              Drag a panel to reorder · width 3–12 of 12 columns · changes apply when you save
            </span>
          </div>
        )}

        {layoutMsg && (
          <p role="status" className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-2xs text-muted-foreground">
            {layoutMsg}
          </p>
        )}

        {noActivity && !editing ? (
          <EmptyState
            icon={<Activity className="size-5" />}
            title="No activity in this reporting window"
            description="Nothing has been recorded for the selected period. Try a wider range, or check that the chat and ticket integrations are connected in Settings."
            actionLabel="Widen to 90 days"
            onAction={() => setWin({ kind: "preset", days: 90 })}
          />
        ) : (
          <DashboardDataProvider value={data}>
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-12">
              {panels.map((panel, index) => (
                <div
                  key={panel.id}
                  className="dash-cell min-w-0"
                  style={{ ["--panel-span" as any]: Math.min(MAX_SPAN, Math.max(MIN_SPAN, panel.span)) }}
                >
                  <PanelFrame
                    panel={panel}
                    index={index}
                    count={panels.length}
                    editing={editing}
                    dragging={dragFrom === index}
                    onEdit={() => setEditor({ index, panel })}
                    onDuplicate={() => {
                      const copy: PanelSpec = {
                        ...panel,
                        id: newPanelId(),
                        title: `${panelTitle(panel)} copy`,
                        options: { ...panel.options },
                      };
                      const next = [...draft];
                      next.splice(index + 1, 0, copy);
                      setDraft(next);
                    }}
                    onRemove={() => setDraft(draft.filter((p) => p.id !== panel.id))}
                    onMove={(dir) => movePanel(index, dir)}
                    onDragStart={() => setDragFrom(index)}
                    onDrop={() => dropOn(index)}
                    onSpan={(span) => setDraft(draft.map((p) => (p.id === panel.id ? { ...p, span } : p)))}
                  >
                    {renderPanelBody(panel, panelTitle(panel))}
                  </PanelFrame>
                </div>
              ))}

              {editing && (
                <button
                  type="button"
                  onClick={openNewPanel}
                  className="dash-cell flex min-h-24 items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-card text-xs font-medium text-muted-foreground transition hover:border-[var(--primary)] hover:text-foreground"
                  style={{ ["--panel-span" as any]: 12 }}
                >
                  <Plus className="size-4" /> Add panel
                </button>
              )}
            </div>
          </DashboardDataProvider>
        )}
      </main>

      {/* ---------------- FOOTER ---------------- */}
      <div className="flex flex-col items-center justify-center gap-2 pt-2 text-3xs text-muted-foreground sm:flex-row">
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
        <span>{panels.length} panels · {layoutLabel}</span>
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

      {editor && (
        <PanelEditor
          initial={editor.panel}
          isNew={editor.index === null}
          onCancel={() => setEditor(null)}
          onSave={(panel) => {
            if (editor.index === null) setDraft([...draft, panel]);
            else setDraft(draft.map((p, i) => (i === editor.index ? panel : p)));
            setEditor(null);
          }}
        />
      )}
    </PageShell>
  );
}
