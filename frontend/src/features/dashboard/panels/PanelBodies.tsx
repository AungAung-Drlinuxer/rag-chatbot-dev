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

import { Card } from "@/components/ui/card";
import { ConversationChart, DonutChart, Legend } from "@/features/dashboard/components/DashboardCharts";
import { DomainRow, HealthRow, KpiCard } from "@/features/dashboard/components/DashboardRows";
import { PriorityBadge, ResultBadge, StatusBadge } from "@/features/dashboard/components/DashboardBits";
import { maskProfanity } from "@/features/dashboard/lib/dashboardUtils";
import { useDashboardData } from "@/features/dashboard/panels/data";
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
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
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
        <div className="flex items-start gap-3 border-t border-[var(--border)] px-5 py-3.5">
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
            <div key={a.key} className="flex items-start gap-3 px-5 py-3">
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
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pb-3 pt-4">
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
      <div className="px-5 pb-4">
        <ConversationChart data={series} />
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

function NeedsReview({ panel, title }: PanelBodyProps) {
  const { needsReview, conversations } = useDashboardData();
  const limit = Math.max(1, Math.min(20, panel.options.limit ?? 5));
  const rows = needsReview.slice(0, limit);
  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          {conversations ? rows.length : "—"}
        </span>
      </div>
      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {rows.length === 0 && (
          <p className="px-5 py-8 text-center text-2xs text-muted-foreground">
            No conversations yet — data appears as users chat.
          </p>
        )}
        {rows.map((conversation) => (
          <div key={`${conversation.time}-${conversation.user}`} className="space-y-1 px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <ResultBadge result={conversation.result} />
                <span className="truncate text-xs font-medium" title={conversation.user}>{conversation.user}</span>
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground" title={conversation.time}>
                {fmtTime(conversation.time)}
              </span>
            </div>
            <p className="truncate text-xs text-muted-foreground" title={maskProfanity(conversation.question)}>
              {maskProfanity(conversation.question)}
            </p>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("ith:view-conversation", {
                  detail: { user: conversation.user, question: conversation.question },
                }));
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs font-medium text-[var(--accent-foreground)] transition hover:bg-accent"
            >
              <Eye className="size-3.5" /> View
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentTickets({ panel, title }: PanelBodyProps) {
  const { tickets, totals } = useDashboardData();
  const limit = Math.max(1, Math.min(20, panel.options.limit ?? 5));
  const rows = (tickets ?? []).slice(0, limit);
  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="flex items-center justify-between px-5 pb-3 pt-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          {tickets ? `${totals.openTickets} open` : "—"}
        </span>
      </div>
      <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
        {rows.length === 0 && (
          <div className="px-5 py-8 text-center text-2xs text-muted-foreground">
            No tickets yet — escalations will appear here.
          </div>
        )}
        {rows.map((ticket) => (
          <div key={ticket.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-muted/50">
            <div className="w-14 shrink-0 font-mono text-2xs font-semibold text-[var(--accent-foreground)]">{ticket.id}</div>
            <div className="min-w-0 flex-1 truncate text-xs font-medium">{ticket.subject}</div>
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function Domains({ title }: PanelBodyProps) {
  const { domains, stats } = useDashboardData();
  const s = stats as any;
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
      <div className="flex items-center justify-between gap-2 px-5 pb-3 pt-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
          {s?.kb_pages != null ? `${s.kb_pages} articles` : "—"}
        </span>
      </div>
      <div className="space-y-3 px-5 pb-4">
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
      <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
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

      <div className="max-h-[300px] divide-y divide-[var(--border)] overflow-y-auto border-t border-[var(--border)]">
        {(health ?? []).length === 0 && (
          <div className="px-5 py-6 text-center text-2xs text-muted-foreground">Health data unavailable.</div>
        )}
        {(health ?? []).map((item) => (
          <HealthRow key={item.key ?? item.name} item={item} />
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--border)] bg-muted/50 px-5 py-2.5">
        <ShieldAlert className="size-3.5 shrink-0 text-[var(--warn)]" />
        <span className="flex-1 text-2xs font-medium">
          Guardrail activity
          <span className="ml-1 font-normal text-muted-foreground">last 7 days</span>
        </span>
        <span className="text-2xs text-muted-foreground">
          {healthSummary.guardrailEvents} event{healthSummary.guardrailEvents === 1 ? "" : "s"}
        </span>
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
  "needs-review": NeedsReview,
  "recent-tickets": RecentTickets,
  domains: Domains,
  knowledge: Workspace,
  health: Health,
  note: Note,
};

export function renderPanelBody(panel: PanelSpec, title: string) {
  const Body = PANEL_BODIES[panel.type] ?? Empty;
  return <Body panel={panel} title={title} />;
}
