/**
 * Panel bodies — the actual content, one per panel type.
 *
 * These are the Overview sections extracted verbatim from the old page: same markup, same
 * copy, same empty states. The only change is where the numbers come from (context instead of
 * component state) and that the heading is passed in, so a renamed panel does not end up with
 * two titles on screen.
 */
import {
  Activity, AlertTriangle, BookOpen, CheckCircle2, Eye, ExternalLink, Gauge,
  MessageSquare, ShieldAlert, Ticket, Users,
} from "lucide-react";

import { ConversationChart, DonutChart, Legend, useChartSize } from "@/features/dashboard/components/DashboardCharts";
import { DomainRow, HealthRow, KpiCard } from "@/features/dashboard/components/DashboardRows";
import { useDashboardData } from "@/features/dashboard/panels/data";
import { BarRow, DayColumns, fmtCost, fmtInt, fmtMs } from "@/features/dashboard/panels/charts";
import type { PanelSpec } from "@/features/dashboard/panels/types";

export type PanelBodyProps = { panel: PanelSpec; title: string };

const fmtTime = (iso: string) => {
  const d = iso
    ? new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`)
    : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(undefined, {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : iso;
};

function Attention({ title }: PanelBodyProps) {
  const { attention, loading, health, totals } = useDashboardData();
  return (
    <section aria-label="Needs attention" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-start justify-between gap-3 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {(attention ?? []).length ? (
              <AlertTriangle className="size-3.5 text-[var(--warn)]" />
            ) : (
              <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
            )}
            {title}
            <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
              {loading ? "…" : attention.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-muted-foreground" role="status" aria-live="polite">
            {loading
              ? "Reading live service and conversation data."
              : attention.length
                ? "Derived from failing dependencies, escalations, the confidence gate and guardrails."
                : "Nothing is blocking right now."}
          </p>
        </div>
      </div>

      {!loading && attention.length === 0 ? (
        <div className="flex items-start gap-3 border-t border-[var(--border)] px-3.5 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--ok)]/12 text-[var(--ok)]">
            <CheckCircle2 className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold">All clear</p>
            <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
              {(health ?? []).length} dependencies healthy · {totals.resolvedPct}% of conversations resolved without a human
              {totals.gatePassPct === null ? "" : ` · ${totals.gatePassPct}% passed the confidence gate`}
            </p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
          {attention.slice(0, 3).map((a) => (
            <div key={a.key} className="flex items-start gap-3 px-3.5 py-2">
              <span
                className={[
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  a.tone === "danger" ? "bg-[var(--danger)]" : a.tone === "warn" ? "bg-[var(--warn)]" : "bg-[var(--ok)]",
                ].join(" ")}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold">{a.title}</p>
                <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{a.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Kpis() {
  const { stats, loading, deltaProps } = useDashboardData();
  const s = stats as any;
  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<MessageSquare className="size-4" />}
        value={stats ? String(s.total_conversations) : "—"}
        title="Total Conversations"
        {...deltaProps("total_conversations", s?.total_conversations ?? 0)}
        loading={loading}
      />
      <KpiCard
        tone="emerald"
        icon={<CheckCircle2 className="size-4" />}
        value={stats ? String(s.resolved_by_bot) : "—"}
        title="Resolved by Bot"
        {...deltaProps("resolved_by_bot", s?.resolved_by_bot ?? 0)}
        loading={loading}
      />
      <KpiCard
        tone="orange"
        icon={<Ticket className="size-4" />}
        value={stats ? String(s.escalated_to_tickets) : "—"}
        title="Escalated to Tickets"
        change={s?.escalated_to_tickets === 0 ? null : deltaProps("escalated_to_tickets", s?.escalated_to_tickets ?? 0).change}
        positive={(s?.deltas?.escalated_to_tickets ?? 0) < 0}
        description={s?.escalated_to_tickets === 0 ? "no escalations this week" : deltaProps("escalated_to_tickets", 0).description}
        loading={loading}
      />
      <KpiCard
        tone="sky"
        icon={<Users className="size-4" />}
        value={stats ? String(s.active_users) : "—"}
        title="Active Users"
        {...deltaProps("active_users", s?.active_users ?? 0)}
        loading={loading}
      />
    </section>
  );
}

function Trend({ title }: PanelBodyProps) {
  const { series, win, rangeLabel } = useDashboardData();
  const [chartRef, chartSize] = useChartSize(620, 240);
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {win.kind === "custom" ? rangeLabel : `last ${win.days} days`} · split by what the assistant did with each conversation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-2xs text-muted-foreground">
          <Legend label="Total conversations" className="bg-[var(--primary)]" />
          <Legend label="Resolved by Bot" className="bg-[var(--ok)]" />
          <Legend label="Escalated" className="bg-[var(--warn)]" />
        </div>
      </div>
      {/* The chart measures its own box, so dragging the panel taller redraws a taller plot
          instead of scaling a 620×240 picture up and letterboxing it. */}
      <div ref={chartRef} className="flex min-h-[140px] flex-1 flex-col px-5 pb-4">
        <ConversationChart data={series} width={chartSize.w} height={chartSize.h} />
      </div>
    </section>
  );
}

function Quality({ title }: PanelBodyProps) {
  const { stats, totals, gateTrend } = useDashboardData();
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-0.5 text-2xs text-muted-foreground">How often the bot finished without a human</p>
      </div>

      <div className="flex items-center gap-4">
        <DonutChart stats={stats} />
        <div className="min-w-0 flex-1 space-y-2.5">
          {[
            { label: "Resolved by bot", pct: totals.resolvedPct, cls: "bg-[var(--ok)]" },
            { label: "Escalated to IT", pct: totals.escalatedPct, cls: "bg-[var(--warn)]" },
            { label: "No action taken", pct: totals.unresolvedPct, cls: "bg-[var(--border)]" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 text-2xs">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <span className={`size-2 shrink-0 rounded-full ${row.cls}`} aria-hidden />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{stats ? `${row.pct}%` : "—"}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-[var(--border)] bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3" /> Confidence gate
          </p>
          <span className="text-xs font-semibold tabular-nums">
            {totals.gatePassPct === null ? "—" : `${totals.gatePassPct}%`}
          </span>
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
          {totals.gateTotal > 0
            ? `${totals.gateAnswered} answered · ${totals.gateCautioned} cautioned`
            : "No gated answers in this window."}
        </p>
        {gateTrend.length === 0 ? (
          <p className="mt-2 text-2xs text-muted-foreground">No gate data yet</p>
        ) : (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[var(--warn)]/35" aria-hidden>
            <span className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${totals.gatePassPct ?? 0}%` }} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Tokens by model — the detail behind the "Tokens in / out" tile.
 *
 * The board said how many tokens the window used but not WHO used them; a model that answers a
 * third of the questions and takes half the tokens is exactly what someone watching spend needs
 * to see. Tokens per answer is the column that makes two models comparable at a glance.
 */
function TokenBreakdown({ title }: PanelBodyProps) {
  const { usage, usageDenied } = useDashboardData();
  if (usageDenied) return <LockedUsage title={title} reason="Administrator permission required to see token usage." />;
  if (!usage) return <LoadingUsage title={title} />;

  const rows = (usage.by_model ?? []).slice(0, 8);
  const t = usage.totals;
  const perAnswer = t.requests > 0 ? Math.round((t.tokens_in + t.tokens_out) / t.requests) : 0;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-2xs text-muted-foreground">
          {fmtInt(perAnswer)} tokens / answer
        </span>
      </div>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        {fmtInt(t.tokens_in)} in · {fmtInt(t.tokens_out)} out · {fmtInt(t.requests)} answers
      </p>

      <div data-list-scroll className="mt-2 min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <p className="py-4 text-2xs text-muted-foreground">No usage recorded in this window.</p>
        ) : (
          <table className="w-full text-2xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr className="border-b border-[var(--border)]">
                <th className="py-1 pr-2 text-left font-medium">Model</th>
                <th className="px-1 py-1 text-right font-medium">Ans</th>
                <th className="px-1 py-1 text-right font-medium">In</th>
                <th className="px-1 py-1 text-right font-medium">Out</th>
                <th className="py-1 pl-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.model} className="border-b border-[var(--border)]/60 last:border-0">
                  <td className="max-w-[9rem] truncate py-1 pr-2" title={m.model}>{m.model}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{fmtInt(m.requests)}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{fmtInt(m.tokens_in)}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{fmtInt(m.tokens_out)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums">{fmtCost(Number(m.cost))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function Domains({ title }: PanelBodyProps) {
  const { domains, stats } = useDashboardData();
  const s = stats as any;
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-center justify-between gap-2 px-3.5 pb-2 pt-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          {s?.kb_pages != null ? `${s.kb_pages} articles` : "—"}
        </span>
      </div>
      <div className="space-y-2 px-3.5 pb-3">
        {(domains ?? []).length === 0 && (
          <div className="py-4 text-center text-2xs text-muted-foreground">No domain data yet.</div>
        )}
        {(domains ?? []).slice(0, 6).map((domain) => (
          <DomainRow key={domain.name} domain={domain} />
        ))}
        {(domains ?? []).length > 6 && (
          <p className="text-2xs text-muted-foreground">+{(domains ?? []).length - 6} more domains</p>
        )}
      </div>
    </section>
  );
}

function Workspace({ title }: PanelBodyProps) {
  const { stats, role } = useDashboardData();
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-2xs text-muted-foreground">
            <BookOpen className="size-3.5" /> KB Articles
          </span>
          <span className="text-xs font-semibold tabular-nums">{stats ? String((stats as any).kb_pages ?? "—") : "—"}</span>
        </div>
        {role === "admin" && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-2xs text-muted-foreground">
              <ShieldAlert className="size-3.5" /> Attacks Blocked (7d)
            </span>
            <span className="text-xs font-semibold tabular-nums">
              {stats ? String((stats as any).attacks_blocked_7d ?? 0) : "—"}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function Health({ title }: PanelBodyProps) {
  const { health, healthSummary, healthDown } = useDashboardData();
  return (
    <section aria-label="System health" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-start justify-between gap-3 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="mt-0.5 truncate text-2xs leading-tight text-muted-foreground">
            {(health ?? []).length === 0
              ? "Checking dependencies…"
              : healthDown.length > 0
                ? `Failing: ${healthDown.join(", ")}`
                : `${(health ?? []).length} dependencies reporting healthy`}
          </p>
        </div>
        <span className={[
          "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium",
          healthSummary.overall === "Healthy"
            ? "bg-[var(--ok)]/12 text-[var(--ok)]"
            : healthSummary.overall === "Down"
              ? "bg-[var(--danger)]/12 text-[var(--danger)]"
              : "bg-[var(--warn)]/12 text-[var(--warn)]",
        ].join(" ")}>
          {healthSummary.overall}
        </span>
      </div>

      <div data-list-scroll className="divide-y divide-[var(--border)] overflow-y-auto border-t border-[var(--border)]">
        {(health ?? []).length === 0 && (
          <div className="px-5 py-6 text-center text-2xs text-muted-foreground">Health data unavailable.</div>
        )}
        {(health ?? []).map((item) => (
          <HealthRow key={item.key ?? item.name} item={item} />
        ))}
      </div>


      <a
        href="http://10.10.10.18:3000/d/rag-platform-health"
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-1.5 border-t border-[var(--border)] px-4 py-2 text-[11px] font-medium text-[var(--accent-foreground)] transition hover:bg-accent"
      >
        <ExternalLink className="size-3" /> Open in Grafana
      </a>
    </section>
  );
}

function Note({ panel, title }: PanelBodyProps) {
  const body = (panel.options.body ?? "").trim();
  return (
    <section className="h-full rounded-2xl border border-[var(--border)] bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {body ? (
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{body}</p>
      ) : (
        <p className="text-2xs text-muted-foreground">
          Empty note — edit this panel to add text (a runbook link, a rotation reminder, anything).
        </p>
      )}
    </section>
  );
}


/**
 * The four panels that used to be the Observability page.
 *
 * They read the same context as everything else, so merging the pages did not add a request
 * per panel. Cost and guardrail data are administrator-only: the panel says so instead of
 * rendering zeroes that look like "we spent nothing".
 */
const LoadingUsage = ({ title }: { title: string }) => (
  <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
    <h2 className="text-sm font-semibold">{title}</h2>
    <p className="mt-1 text-2xs text-muted-foreground">Loading usage…</p>
  </section>
);

function LockedUsage({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-[var(--border)] bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
        <ShieldAlert className="size-3.5" /> {reason}
      </p>
    </section>
  );
}

function UsageKpis({ title }: PanelBodyProps) {
  const { usage, usageError, usageDenied } = useDashboardData();
  if (usageDenied) return <LockedUsage title={title} reason="Administrator permission required to see token and cost data." />;
  const t = usage?.totals;
  const tiles = [
    { label: "Answers", value: t ? fmtInt(t.requests) : "—", icon: <MessageSquare className="size-3.5" /> },
    { label: "Tokens in / out", value: t ? `${fmtInt(t.tokens_in)} / ${fmtInt(t.tokens_out)}` : "—", icon: <Eye className="size-3.5" /> },
    { label: "Estimated cost", value: t ? fmtCost(t.cost_usd) : "—", icon: <Gauge className="size-3.5" /> },
    { label: "p95 latency", value: t ? fmtMs(t.p95_latency_ms) : "—", icon: <Activity className="size-3.5" /> },
  ];
  return (
    <section aria-label="Tokens, cost and latency" className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-2xs text-muted-foreground">{usage?.range.label ?? ""}</span>
      </div>
      {usageError && (
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-[var(--danger)]">
          <AlertTriangle className="size-3.5" /> {usageError}
        </p>
      )}
      {/* Four tiles, not a stack of stat cards: this band is 150–250px tall on a one-screen
          board, so the labels drop to 10px and the numbers stay the largest thing in the tile. */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-[var(--border)] bg-background/40 px-2 py-1.5"
            title={tile.label === "p95 latency" && t && t.p50_latency_ms > 0
              ? `p50 ${fmtMs(t.p50_latency_ms)} · max ${fmtMs(t.max_latency_ms)}`
              : undefined}
          >
            <div className="flex items-center gap-1 text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">
              {tile.icon}{tile.label}
            </div>
            <p className="mt-0.5 truncate text-base font-semibold tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function CostTrend({ title }: PanelBodyProps) {
  const { usage, usageDenied } = useDashboardData();
  if (usageDenied) return <LockedUsage title={title} reason="Administrator permission required to see spend." />;
  if (!usage) return <LoadingUsage title={title} />;
  const series = usage.series;
  const tokens = series.reduce((a, d) => a + d.tokens_in + d.tokens_out, 0);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {tokens === 0 ? (
        <p className="mt-6 text-center text-2xs text-muted-foreground">No answers in this window.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-2xs text-muted-foreground">Tokens / day</p>
            <DayColumns data={series} pick={(d) => d.tokens_in + d.tokens_out} format={fmtInt} fill />
          </div>
          <div>
            <p className="text-2xs text-muted-foreground">Cost / day</p>
            <DayColumns data={series} pick={(d) => Number(d.cost)} format={fmtCost} fill />
          </div>
        </div>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">
        Estimate from the app&apos;s price table — not the provider invoice.
      </p>
    </section>
  );
}

function ModelCost({ title }: PanelBodyProps) {
  const { usage, usageDenied } = useDashboardData();
  if (usageDenied) return <LockedUsage title={title} reason="Administrator permission required to see spend." />;
  if (!usage) return <LoadingUsage title={title} />;
  const models = (usage.by_model ?? []).slice(0, 6);
  const max = Math.max(...models.map((m) => Number(m.cost)), 0);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-2xs text-muted-foreground">{fmtCost(usage?.totals.cost_usd ?? 0)} total</span>
      </div>
      <div className="mt-3 space-y-2.5">
        {models.length === 0 && <p className="text-2xs text-muted-foreground">No usage recorded yet.</p>}
        {models.map((m) => (
          <BarRow
            key={m.model}
            label={m.model}
            value={Number(m.cost)}
            max={max}
            format={fmtCost}
            title={`${m.model}: ${fmtInt(m.requests)} answers · ${fmtInt(m.tokens_in)} in / ${fmtInt(m.tokens_out)} out`}
          />
        ))}
      </div>
    </section>
  );
}

function OutcomeMix({ title }: PanelBodyProps) {
  const { usage, totals, usageDenied } = useDashboardData();
  const decisions = usage?.decisions ?? [];
  const total = decisions.reduce((a, d) => a + d.n, 0);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 text-2xs text-muted-foreground">
        Gate pass rate {totals.gatePassPct == null ? "—" : `${totals.gatePassPct}%`}
      </p>
      <div className="mt-3 space-y-2">
        {usageDenied && <p className="text-2xs text-muted-foreground">Outcome detail needs administrator access.</p>}
        {!usageDenied && total === 0 && <p className="text-2xs text-muted-foreground">No answers in this window.</p>}
        {!usageDenied && decisions.map((d) => (
          <div key={d.decision} className="flex items-center justify-between gap-2 text-2xs">
            <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
              <span className={[
                "size-2 rounded-full",
                d.decision === "answer" ? "bg-[var(--ok)]"
                  : d.decision === "caution" ? "bg-[var(--warn)]"
                    : d.decision === "escalate" ? "bg-[var(--danger)]" : "bg-[var(--border)]",
              ].join(" ")} />
              {d.decision}
            </span>
            <span className="font-medium tabular-nums">
              {fmtInt(d.n)}
              <span className="text-muted-foreground"> · {Math.round((d.n / total) * 1000) / 10}%</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-2xs">
        <span className="text-muted-foreground">Resolved / escalated (conversations)</span>
        <span className="font-medium tabular-nums">{fmtInt(totals.resolved)} / {fmtInt(totals.escalated)}</span>
      </div>
    </section>
  );
}

function GuardrailEvents({ panel, title }: PanelBodyProps) {
  const { guardrailEvents, guardrailDenied, usage } = useDashboardData();
  const limit = Math.max(1, Math.min(panel.options.limit ?? 10, 25));
  const rows = guardrailEvents.slice(0, limit);
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pb-2 pt-4">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {guardrailDenied ? "Administrator permission required to list refusals." : "Newest refusals, from the audit trail."}
          </p>
        </div>
        {!guardrailDenied && usage && (
          <span className="shrink-0 rounded-md bg-[var(--warn)]/12 px-1.5 py-0.5 text-2xs font-medium text-[var(--warn)]">
            {fmtInt(usage.guardrail_total)} events
          </span>
        )}
      </div>
      <div className="overflow-x-auto border-t border-[var(--border)]">
        <table className="w-full text-left text-2xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-4 py-1.5 font-medium">When</th>
              <th className="px-4 py-1.5 font-medium">Type</th>
              <th className="px-4 py-1.5 font-medium">User</th>
              <th className="px-4 py-1.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((e, i) => (
              <tr key={`${e.created_at}-${i}`}>
                <td className="whitespace-nowrap px-4 py-1.5 text-muted-foreground">{fmtTime(e.created_at ?? "") || "—"}</td>
                <td className="px-4 py-1.5">{e.action.replace("guardrail.", "")}</td>
                <td className="px-4 py-1.5">{e.username || "—"}</td>
                <td className="max-w-[36ch] truncate px-4 py-1.5 text-muted-foreground" title={e.detail || ""}>{e.detail || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                  {guardrailDenied ? "Ask an administrator for access." : "No guardrail events recorded."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const Empty = ({ title }: PanelBodyProps) => (
  <section className="rounded-2xl border border-dashed border-[var(--border)] bg-card p-4">
    <h2 className="text-sm font-semibold">{title}</h2>
    <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
      <Activity className="size-3.5" /> This panel type is not available in this build — edit or remove it.
    </p>
  </section>
);

export const PANEL_BODIES: Record<string, (props: PanelBodyProps) => JSX.Element> = {
  attention: Attention,
  kpis: Kpis,
  trend: Trend,
  quality: Quality,
  domains: Domains,
  knowledge: Workspace,
  health: Health,
  note: Note,
  "usage-kpis": UsageKpis,
  "cost-trend": CostTrend,
  "model-cost": ModelCost,
  "token-breakdown": TokenBreakdown,
  "outcome-mix": OutcomeMix,
  "guardrail-events": GuardrailEvents,
};

export function renderPanelBody(panel: PanelSpec, title: string) {
  const Body = PANEL_BODIES[panel.type] ?? Empty;
  return <Body panel={panel} title={title} />;
}
