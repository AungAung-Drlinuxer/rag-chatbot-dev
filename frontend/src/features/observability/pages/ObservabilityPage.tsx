/**
 * Observability — the Grafana board, rebuilt inside the app.
 *
 * Every figure is read from `/api/observability/*`, which aggregates `llm_usage` and
 * `audit_log`. Nothing here needs Prometheus, Loki, Tempo or Grafana, and nothing here is
 * estimated: if the table has no rows, the page says "no answers in this window" rather than
 * drawing a plausible line.
 *
 * What it does NOT show, on purpose: node CPU, container memory, pod restarts. Those numbers
 * do not exist in the database and cannot be derived from it; inventing them would make this
 * page look more authoritative than the source it reads.
 */
import { Activity, AlertTriangle, ArrowDownRight, Clock, Coins, Hash, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/ui/page";
import {
  getGuardrailEvents,
  getObservabilityOverview,
  getServiceHealth,
  type GuardrailEvent,
  type ObservabilityOverview,
} from "@/features/observability/api";

const RANGES = [7, 30, 90] as const;

const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-US");
// A NUMERIC column can arrive as a string; coerce before formatting rather than trusting the wire.
const fmtCost = (value: number | string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
};
const fmtMs = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

function Stat({
  icon, label, value, hint, tone = "default",
}: {
  icon: React.ReactNode; label: string; value: string; hint?: string;
  tone?: "default" | "ok" | "warn" | "danger";
}) {
  const toneClass = {
    default: "text-foreground",
    ok: "text-[var(--ok)]",
    warn: "text-[var(--warn)]",
    danger: "text-[var(--danger)]",
  }[tone];
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {label}
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One horizontal bar row — width is share of the largest value, value is always labelled. */
function BarRow({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-2xs">
      <span className="w-28 shrink-0 truncate text-muted-foreground" title={label}>{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
        <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${width}%` }} />
      </span>
      <span className="w-20 shrink-0 text-right font-medium tabular-nums">
        {suffix === "$" ? fmtCost(value) : fmtInt(value)}
      </span>
    </div>
  );
}

/** Per-day column chart. Values are printed above each column, so a log scale is unnecessary. */
function DayChart({
  data, pick, label, format,
}: {
  data: ObservabilityOverview["series"];
  pick: (d: ObservabilityOverview["series"][number]) => number;
  label: string;
  format: (n: number) => string;
}) {
  const values = data.map(pick);
  const max = Math.max(...values, 0);
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <h2 className="text-sm font-semibold">{label}</h2>
      {max === 0 ? (
        <p className="mt-6 text-center text-2xs text-muted-foreground">No data in this window.</p>
      ) : (
        <div className="mt-4 flex h-32 items-end gap-1">
          {data.map((d) => {
            const v = pick(d);
            const h = max > 0 ? Math.max(v > 0 ? 4 : 0, Math.round((v / max) * 100)) : 0;
            return (
              <div key={d.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.day}: ${format(v)}`}>
                <span className="text-[9px] leading-none text-muted-foreground opacity-0 transition group-hover:opacity-100">
                  {format(v)}
                </span>
                <span
                  className="w-full rounded-t bg-[var(--primary)]/75 transition group-hover:bg-[var(--primary)]"
                  style={{ height: `${h}%` }}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex justify-between text-[9px] text-muted-foreground">
        <span>{data[0]?.day?.slice(5)}</span>
        <span>{data[data.length - 1]?.day?.slice(5)}</span>
      </div>
    </section>
  );
}

export default function ObservabilityPage({ role }: { role?: string }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [data, setData] = useState<ObservabilityOverview | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getServiceHealth>> | null>(null);
  const [events, setEvents] = useState<GuardrailEvent[]>([]);
  const [eventsDenied, setEventsDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const [ov, h] = await Promise.all([getObservabilityOverview(range), getServiceHealth()]);
      setData(ov);
      setHealth(h);
      try {
        const ev = await getGuardrailEvents(25);
        setEvents(ev.events);
        setEventsDenied(false);
      } catch {
        // Non-admin: the strip below still shows the counts, the table says why it is empty.
        setEvents([]);
        setEventsDenied(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(days); }, [days, load]);

  const decisions = useMemo(() => {
    const total = (data?.decisions ?? []).reduce((a, d) => a + d.n, 0);
    return (data?.decisions ?? []).map((d) => ({ ...d, pct: pct(d.n, total) }));
  }, [data]);

  const maxModelCost = Math.max(...(data?.by_model ?? []).map((m) => m.cost), 0);
  const maxGuardrail = Math.max(...(data?.guardrails ?? []).map((g) => g.n), 0);
  const maxDomain = Math.max(...(data?.domains ?? []).map((d) => d.n), 0);

  const down = health?.down ?? [];
  const budgets = data?.totals ?? null;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={["Operations", "Observability"]}
        eyebrow="Operations"
        icon={<Activity className="size-5" />}
        badge={role === "admin" ? "Administrator" : undefined}
        title="Observability"
        description="Tokens, cost, latency and guardrail activity — read from the application's own tables."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-card p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                className={[
                  "rounded-md px-2.5 py-1 text-2xs font-medium transition",
                  days === r ? "bg-[var(--primary)] text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                ].join(" ")}
              >
                {r}d
              </button>
            ))}
            <Button size="sm" variant="ghost" className="ml-1 h-7 rounded-md px-2 text-2xs" onClick={() => void load(days)}>
              Refresh
            </Button>
          </div>
        }
      />

      <main className="space-y-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/8 px-3 py-2 text-2xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]" />
            <span>
              <strong className="font-semibold">Metrics unavailable.</strong> {error}
            </span>
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={<Hash className="size-3.5" />}
            label="Answers"
            value={loading && !budgets ? "…" : fmtInt(budgets?.requests)}
            hint={data?.range.label}
          />
          <Stat
            icon={<ArrowDownRight className="size-3.5" />}
            label="Tokens in / out"
            value={budgets ? `${fmtInt(budgets.tokens_in)} / ${fmtInt(budgets.tokens_out)}` : "—"}
            hint="what the model read / wrote"
          />
          <Stat
            icon={<Coins className="size-3.5" />}
            label="Estimated cost"
            value={budgets ? fmtCost(budgets.cost_usd) : "—"}
            hint="price table in the app, not the provider invoice"
          />
          <Stat
            icon={<Clock className="size-3.5" />}
            label="p95 latency"
            value={budgets ? fmtMs(budgets.p95_latency_ms) : "—"}
            hint={budgets ? `p50 ${fmtMs(budgets.p50_latency_ms)} · max ${fmtMs(budgets.max_latency_ms)}` : undefined}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <DayChart data={data?.series ?? []} pick={(d) => d.tokens_in + d.tokens_out} label="Tokens per day" format={fmtInt} />
          <DayChart data={data?.series ?? []} pick={(d) => Number(d.cost)} label="Cost per day (USD)" format={fmtCost} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">Decisions</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">How each answer ended</p>
            <div className="mt-3 space-y-2.5">
              {decisions.length === 0 && <p className="text-2xs text-muted-foreground">No answers in this window.</p>}
              {decisions.map((d) => (
                <div key={d.decision} className="flex items-center justify-between gap-2 text-2xs">
                  <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
                    <span className={`size-2 rounded-full ${d.decision === "answer" ? "bg-[var(--ok)]" : d.decision === "caution" ? "bg-[var(--warn)]" : d.decision === "escalate" ? "bg-[var(--danger)]" : "bg-[var(--border)]"}`} />
                    {d.decision}
                  </span>
                  <span className="font-medium tabular-nums">{fmtInt(d.n)} <span className="text-muted-foreground">· {d.pct}%</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">Tokens by model</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">Where the spend went</p>
            <div className="mt-3 space-y-2.5">
              {(data?.by_model ?? []).length === 0 && <p className="text-2xs text-muted-foreground">No usage recorded yet.</p>}
              {(data?.by_model ?? []).slice(0, 5).map((m) => (
                <BarRow key={m.model} label={m.model} value={m.cost} max={maxModelCost} suffix="$" />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldAlert className="size-3.5 text-[var(--warn)]" /> Guardrails
            </h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {fmtInt(data?.guardrail_total)} events blocked in this window
            </p>
            <div className="mt-3 space-y-2.5">
              {(data?.guardrails ?? []).length === 0 && <p className="text-2xs text-muted-foreground">No guardrail events.</p>}
              {(data?.guardrails ?? []).map((g) => (
                <BarRow key={g.action} label={g.action.replace("guardrail.", "")} value={g.n} max={maxGuardrail} />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border)] bg-card p-4">
            <h2 className="text-sm font-semibold">Top domains</h2>
            <div className="mt-3 space-y-2.5">
              {(data?.domains ?? []).length === 0 && <p className="text-2xs text-muted-foreground">No classified answers yet.</p>}
              {(data?.domains ?? []).map((d) => (
                <BarRow key={d.domain} label={d.domain} value={d.n} max={maxDomain} />
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-card">
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <div>
                <h2 className="text-sm font-semibold">Service health</h2>
                <p className="mt-0.5 text-2xs text-muted-foreground">
                  {down.length ? `Failing: ${down.join(", ")}` : `${health?.services.length ?? 0} dependencies answering`}
                </p>
              </div>
              <span className={[
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                down.length ? "bg-[var(--danger)]/12 text-[var(--danger)]" : "bg-[var(--ok)]/12 text-[var(--ok)]",
              ].join(" ")}>
                {down.length ? "Degraded" : "Healthy"}
              </span>
            </div>
            <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
              {(health?.services ?? []).map((s) => (
                <div key={s.key} className="flex items-center gap-2 px-4 py-2 text-2xs">
                  <span className={`size-1.5 rounded-full ${s.status === "Healthy" ? "bg-[var(--ok)]" : "bg-[var(--danger)]"}`} />
                  <span className="flex-1 truncate">{s.name}</span>
                  {s.detail && <span className="max-w-[45%] truncate text-muted-foreground" title={s.detail}>{s.detail}</span>}
                  <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{fmtMs(s.latency_ms)}</span>
                </div>
              ))}
              {(health?.services ?? []).length === 0 && (
                <p className="px-4 py-6 text-center text-2xs text-muted-foreground">Health data unavailable.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-card">
          <div className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <h2 className="text-sm font-semibold">Recent guardrail events</h2>
              <p className="mt-0.5 text-2xs text-muted-foreground">
                {eventsDenied ? "Administrator permission required to list events." : "Newest refusals, from the audit trail."}
              </p>
            </div>
            <span className="text-2xs text-muted-foreground">
              {data ? `KB ${fmtInt(data.counts.kb_articles)} · open tickets ${fmtInt(data.counts.tickets_open)} · users ${fmtInt(data.counts.users)}` : ""}
            </span>
          </div>
          <div className="overflow-x-auto border-t border-[var(--border)]">
            <table className="w-full text-left text-2xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {events.map((e, i) => (
                  <tr key={`${e.created_at}-${i}`}>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {e.created_at ? new Date(e.created_at).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}
                    </td>
                    <td className="px-4 py-2">{e.action.replace("guardrail.", "")}</td>
                    <td className="px-4 py-2">{e.username || "—"}</td>
                    <td className="max-w-[36ch] truncate px-4 py-2 text-muted-foreground" title={e.detail || ""}>{e.detail || "—"}</td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      {eventsDenied ? "Ask an administrator for access." : "No guardrail events recorded."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <p className="pb-2 text-center text-3xs text-muted-foreground">
          {data ? `Generated ${new Date(data.generated_at).toLocaleString()} · ${data.range.label}` : ""}
          {" · "}node/container metrics are not shown: they are not stored in this application&apos;s database.
        </p>
      </main>
    </PageShell>
  );
}
