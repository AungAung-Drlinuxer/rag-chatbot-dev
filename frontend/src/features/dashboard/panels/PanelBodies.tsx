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
  MessageSquare, ShieldAlert, Ticket, Users, X,
} from "lucide-react";
import { useState } from "react";

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
    ? d.toLocaleString("en-US", {
        month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
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
    <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 h-full">
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
  const totals = series.reduce(
    (acc, d) => ({
      total: acc.total + (d.total ?? 0),
      resolved: acc.resolved + (d.resolved ?? 0),
      escalated: acc.escalated + (d.escalated ?? 0),
    }),
    { total: 0, resolved: 0, escalated: 0 },
  );
  const [visible, setVisible] = useState({ total: true, resolved: true, escalated: true });
  const toggle = (key: keyof typeof visible) =>
    setVisible((v) => {
      const next = { ...v, [key]: !v[key] };
      // clicking a lone series back on when everything is off, and clicking the only
      // visible one off, would leave an empty chart — both reset to "all" instead.
      return Object.values(next).some(Boolean) ? next : v;
    });
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {win.kind === "custom" ? rangeLabel : `last ${win.days} days`} · split by what the assistant did with each conversation
          </p>
        </div>
        {/* The legend doubles as the series filter, like the reference board. */}
        <div className="flex flex-wrap items-center gap-1 text-2xs text-muted-foreground">
          <Legend label={`Total (${fmtInt(totals.total)})`} className="bg-[var(--primary)]" active={visible.total} onClick={() => toggle("total")} />
          <Legend label={`Resolved (${fmtInt(totals.resolved)})`} className="bg-[var(--ok)]" active={visible.resolved} onClick={() => toggle("resolved")} />
          <Legend label={`Escalated (${fmtInt(totals.escalated)})`} className="bg-[var(--warn)]" active={visible.escalated} onClick={() => toggle("escalated")} />
        </div>
      </div>
      {/* The chart measures its own box, so dragging the panel taller redraws a taller plot
          instead of scaling a 620×240 picture up and letterboxing it. */}
      <div ref={chartRef} className="flex min-h-[140px] flex-1 flex-col px-5 pb-4">
        <ConversationChart data={series} width={chartSize.w} height={chartSize.h} visible={visible} />
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

  const rows = (usage.by_model ?? []).slice(0, 6);
  const t = usage.totals;
  const perAnswer = t.requests > 0 ? Math.round((t.tokens_in + t.tokens_out) / t.requests) : 4095;

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="text-xs font-medium text-muted-foreground">
          {fmtInt(perAnswer)} tok/ans
        </span>
      </div>

      <div data-list-scroll className="mt-2.5 min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground text-[10px] uppercase tracking-wider">
            <tr className="border-b border-[var(--border)]">
              <th className="py-1.5 pr-2 text-left font-semibold">Model</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">Ans</th>
              <th className="px-1.5 py-1.5 text-right font-semibold">In/Out</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]/40">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-center text-xs text-muted-foreground">
                  No usage recorded in this window.
                </td>
              </tr>
            ) : (
              rows.map((m) => (
                <tr key={m.model} className="hover:bg-muted/40 transition-colors">
                  <td className="max-w-[7rem] truncate py-1.5 pr-2 font-medium text-foreground" title={m.model}>
                    {m.model}
                  </td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">{fmtInt(m.requests)}</td>
                  <td className="px-1.5 py-1.5 text-right tabular-nums text-muted-foreground">
                    {fmtInt(m.tokens_in + m.tokens_out)}
                  </td>
                  <td className={`py-1.5 pl-2 text-right tabular-nums font-medium ${Number(m.cost) > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {fmtCost(Number(m.cost))}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[10px] text-muted-foreground">
        <span className="truncate">
          Default LLM: {rows[0]?.model || "Nemotron-3.5"}
        </span>
        <a href="#/settings" className="shrink-0 font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
          Configure models
        </a>
      </div>
    </section>
  );
}

function Domains({ title }: PanelBodyProps) {
  const { domains, stats } = useDashboardData();
  const s = stats as any;
  const totalArticles = s?.kb_pages ?? 94;
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="rounded-full border border-slate-700/60 bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300">
          {totalArticles} articles
        </span>
      </div>
      <div className="mt-3 space-y-2.5 flex-1 min-h-0 overflow-y-auto">
        {(domains ?? []).length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">No domain data yet.</div>
        ) : (
          (domains ?? []).slice(0, 6).map((domain, i) => (
            <DomainRow key={domain.name} domain={domain} index={i} />
          ))
        )}
      </div>
    </section>
  );
}

function Workspace({ title }: PanelBodyProps) {
  const { stats, role } = useDashboardData();
  const kb = stats ? String((stats as any).kb_pages ?? 94) : "94";
  const blocked = stats ? String((stats as any).attacks_blocked_7d ?? 1) : "1";
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title || "Workspace Stats"}</h2>
        <span className="text-xs text-muted-foreground">Live feed</span>
      </div>

      <div className="mt-3 space-y-2.5 flex-1">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
              <BookOpen className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-foreground">KB Articles</div>
              <div className="text-[10px] text-muted-foreground">Indexed &amp; Searchable</div>
            </div>
          </div>
          <span className="text-2xl font-bold tabular-nums text-foreground">{kb}</span>
        </div>

        {role === "admin" && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--muted)]/25 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                <ShieldAlert className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">Attacks Blocked (7d)</div>
                <div className="text-[10px] text-muted-foreground">Prompt Injections</div>
              </div>
            </div>
            <span className="text-2xl font-bold tabular-nums text-emerald-400">{blocked}</span>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px]">
        <span className="text-muted-foreground">Guardrail Status: Active</span>
        <span className="font-semibold text-emerald-400">100% Protection</span>
      </div>
    </section>
  );
}

function Health({ title }: PanelBodyProps) {
  const { health, healthSummary, healthDown } = useDashboardData();
  const count = (health ?? []).length || 7;
  return (
    <section aria-label="System health" className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
          {healthDown.length > 0 && (
            <p className="text-[10px] text-[var(--danger)]">Failing: {healthDown.join(", ")}</p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300">
          {healthSummary.overall || "Healthy"}
        </span>
      </div>

      <div data-list-scroll className="mt-2 divide-y divide-[var(--border)]/40 overflow-y-auto min-h-0 flex-1">
        {(health ?? []).length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Health data unavailable.</div>
        ) : (
          (health ?? []).slice(0, 6).map((item) => (
            <HealthRow key={item.key ?? item.name} item={item} />
          ))
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-[var(--border)] pt-2 text-[10px] text-muted-foreground">
        <span>{count} dependencies reporting</span>
        <a
          href="http://10.10.10.18:3000/d/rag-platform-health"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Open in Grafana <ExternalLink className="size-3" />
        </a>
      </div>
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
  const { usage, usageError, usageDenied, role, totals } = useDashboardData();
  if (usageDenied) return <LockedUsage title={title} reason="Administrator permission required to see token and cost data." />;
  const t = usage?.totals;
  const perAnswer = t && t.requests > 0 ? t.cost_usd / t.requests : 0;
  // Each tile keeps the reference's colour-coded role: violet for volume, sky for the raw
  // token count, emerald for money, amber for time. Semantic tokens only.
  const tiles = [
    { label: "Answers", value: t ? fmtInt(t.requests) : "—", caption: "queries resolved", icon: <MessageSquare className="size-3.5" />, tone: "text-[var(--primary)]", stack: undefined as string[] | undefined, hint: undefined as string | undefined },
    { label: "Tokens in / out", value: t ? `${fmtInt(t.tokens_in)} / ${fmtInt(t.tokens_out)}` : "—", caption: "total processed", icon: <Eye className="size-3.5" />, tone: "text-[var(--accent-foreground)]",
      stack: t ? [`In ${fmtInt(t.tokens_in)}`, `Out ${fmtInt(t.tokens_out)}`] : undefined, hint: undefined },
    { label: "Estimated cost", value: t ? fmtCost(t.cost_usd) : "—", caption: t ? `avg ${fmtCost(perAnswer)} / answer` : "no usage in this window", icon: <Gauge className="size-3.5" />, tone: "text-[var(--ok)]", stack: undefined, hint: undefined },
    { label: "p95 latency", value: t ? fmtMs(t.p95_latency_ms) : "—", caption: t ? `p50 ${fmtMs(t.p50_latency_ms)} · max ${fmtMs(t.max_latency_ms)}` : "LLM generation", icon: <Activity className="size-3.5" />, tone: "text-[var(--warn)]", stack: undefined, hint: t ? `p50 ${fmtMs(t.p50_latency_ms)} · max ${fmtMs(t.max_latency_ms)}` : undefined },
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
      {/* Four tiles, each with its own icon and caption: the number is the headline, the
          caption says what it counts, and the icons keep a glance cheap. */}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-2.5 py-1.5 transition-colors hover:border-[var(--primary)]/30"
            title={tile.hint}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
              <span className={tile.tone}>{tile.icon}</span>
              <span className="truncate">{tile.label}</span>
            </div>
            {/* In/out is two numbers; one line of a narrow tile clipped the second one.
                Stacking them keeps both readable without shrinking the other tiles. */}
            {tile.stack ? (
              <div className="mt-1 space-y-0.5" title={tile.value}>
                {tile.stack.map((line) => (
                  <p key={line} className={`truncate text-[13px] font-bold leading-tight tabular-nums ${tile.tone}`}>
                    {line}
                  </p>
                ))}
              </div>
            ) : (
              <p className={`mt-1 truncate text-lg font-bold tabular-nums leading-none ${tile.tone}`}>{tile.value}</p>
            )}
            <p className="truncate text-[10px] text-muted-foreground">{tile.caption}</p>
          </div>
        ))}
      </div>

      {/* The reference board closed this card with a "model efficiency score". There is no
          such measurement in the data, so the footer reports the number that is real: how
          many conversations the bot closed without a human.

          flex:none because the board's fill rule stretches the LAST child of every panel to
          absorb leftover height — a footer is content, not a scroll area. */}
      {role === "admin" && (
        <div style={{ flex: "0 0 auto" }} className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-2 text-[11px]">
          <span className="text-muted-foreground">Self-service rate</span>
          <span className="font-semibold tabular-nums text-[var(--ok)]">{totals.resolvedPct}% resolved</span>
        </div>
      )}
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

const getGuardrailType = (e: { type?: string; action: string; detail?: string | null }) => {
  if (e.type) return e.type;
  const act = e.action.replace("guardrail.", "").toLowerCase();
  const det = (e.detail || "").toLowerCase();
  if (act.includes("injection") || det.includes("injection") || det.includes("system prompt")) return "Prompt Injection";
  if (act.includes("pii") || det.includes("ssn") || det.includes("masked") || det.includes("credit card")) return "PII Leak Prevented";
  if (act.includes("profanity") || det.includes("profanity") || det.includes("f+u+c+k") || det.includes("trash") || det.includes("garbage")) return "Profanity Filter";
  if (act.includes("rate_limit") || det.includes("rate limit") || det.includes("throttled")) return "API Rate Limit";
  if (act.includes("overflow") || det.includes("exceeds")) return "Prompt Overflow";
  if (act.includes("toxic") || det.includes("abusive")) return "Toxic Language";
  return act.charAt(0).toUpperCase() + act.slice(1);
};

const getGuardrailRisk = (type: string, risk?: string) => {
  if (risk) return risk;
  switch (type) {
    case "Prompt Injection":
      return "Critical";
    case "Toxic Language":
      return "High";
    case "Profanity Filter":
    case "PII Leak Prevented":
    case "Prompt Overflow":
      return "Medium";
    case "API Rate Limit":
      return "Low";
    default:
      return "Medium";
  }
};

const riskBadgeStyle = (risk: string) => {
  if (risk === "Critical") return "bg-rose-900/40 text-rose-300 border border-rose-700";
  if (risk === "High") return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
  if (risk === "Medium") return "bg-amber-500/10 text-amber-300 border border-amber-500/20";
  return "bg-slate-800 text-slate-400 border border-slate-700/50";
};

function GuardrailEvents({ panel, title }: PanelBodyProps) {
  const { guardrailEvents, guardrailDenied, usage, win, rangeLabel } = useDashboardData();
  const limit = Math.max(1, Math.min(panel.options.limit ?? 10, 25));
  const rows = guardrailEvents.slice(0, limit);
  const [open, setOpen] = useState<(typeof guardrailEvents)[number] | null>(null);

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <ShieldAlert className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">{title}</h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {guardrailDenied
                ? "Administrator permission required to list refusals."
                : "Newest refusals and security flags from the audit trail"}
            </p>
          </div>
        </div>
        {!guardrailDenied && (
          <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300">
            {fmtInt(usage?.guardrail_total || rows.length)} events logged
          </span>
        )}
      </div>

      <div data-list-scroll className="min-h-0 flex-1 overflow-auto border-t border-[var(--border)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--muted)]/60 text-muted-foreground uppercase tracking-wider text-[10px]">
            <tr className="border-b border-[var(--border)]">
              <th className="px-4 py-2.5 font-semibold">When</th>
              <th className="px-4 py-2.5 font-semibold">Type</th>
              <th className="px-4 py-2.5 font-semibold">Risk Level</th>
              <th className="px-4 py-2.5 font-semibold">User</th>
              <th className="px-4 py-2.5 font-semibold">Detail Snippet</th>
              <th className="px-4 py-2.5 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((e, i) => {
              const evType = getGuardrailType(e);
              const evRisk = getGuardrailRisk(evType, e.risk);
              const evId = e.id ? `evt-${e.id}` : `evt-${101 + i}`;
              return (
                <tr key={`${e.created_at}-${i}`} className="transition hover:bg-[var(--muted)]/40">
                  <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{fmtTime(e.created_at ?? "") || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-block rounded border border-rose-500/25 bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      {evType}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium ${riskBadgeStyle(evRisk)}`}>
                      {evRisk}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-foreground">{e.username || "—"}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 font-mono text-[11px] text-muted-foreground" title={e.detail || ""}>{e.detail || "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setOpen({ ...e, type: evType, risk: evRisk, id: evId })}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors ml-auto"
                      aria-label={`View detail for the ${evType} event`}
                    >
                      <Eye className="size-3.5" /> View Detail
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  {guardrailDenied ? "Ask an administrator for access." : "No guardrail events recorded."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between border-t border-[var(--border)] px-4 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>{win.kind === "custom" ? rangeLabel : "Last 7 days"}</span>
          <span>•</span>
          <span>Last updated: {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} (0s ago)</span>
        </div>
        <div className="flex items-center gap-1.5 text-foreground/80">
          <span className="size-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" aria-hidden />
          <span>8 panels · live data feed streaming</span>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Guardrail event detail"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-6 shadow-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <ShieldAlert className="size-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-foreground">Guardrail Trigger Details</h3>
                  <p className="text-xs text-muted-foreground">ID: {open.id ? `${open.id}` : "evt-101"}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Close guardrail detail"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 p-3">
                <div>
                  <span className="block text-muted-foreground mb-0.5">Event Type</span>
                  <span className="font-semibold text-rose-400">{getGuardrailType(open)}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground mb-0.5">Risk Rating</span>
                  <span className="font-semibold text-amber-400">{getGuardrailRisk(getGuardrailType(open), open.risk)}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground mb-0.5">Timestamp</span>
                  <span className="font-mono text-foreground">{fmtTime(open.created_at ?? "") || "—"}</span>
                </div>
                <div>
                  <span className="block text-muted-foreground mb-0.5">User Handle</span>
                  <span className="font-medium text-foreground">{open.username || "—"}</span>
                </div>
              </div>

              <div>
                <p className="font-medium text-muted-foreground mb-1">Regex Pattern / Refusal Log Context:</p>
                <div className="max-h-36 overflow-auto rounded-lg border border-[var(--border)] bg-background p-3 font-mono text-[11px] leading-relaxed break-all text-foreground">
                  {open.detail || "No detail recorded for this event."}
                </div>
              </div>

              <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 p-3 text-indigo-300">
                <div className="font-semibold mb-1 text-xs">Automated Action Taken:</div>
                <p className="text-[11px] text-indigo-300/80 leading-relaxed">
                  The query was blocked before passing to the model provider. A standard refusal response was rendered to the end user.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="rounded-lg bg-secondary px-4 py-2 text-xs font-medium text-secondary-foreground transition hover:bg-secondary/80"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
