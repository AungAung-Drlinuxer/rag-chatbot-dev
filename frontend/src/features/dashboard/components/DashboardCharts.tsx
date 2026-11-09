/**
 * DashboardCharts.tsx — extracted from DashboardPage.
 *
 * The SVG charts: they take already-shaped data and draw it.
 */

import { useEffect, useRef, useState } from "react";

import { niceTickStep } from "@/features/dashboard/lib/dashboardUtils";

export function MiniSparkline() {
  return (
    <svg
      width="65"
      height="34"
      viewBox="0 0 65 34"
      fill="none"
      className="text-blue-500"
    >
      <path
        d="M2 28 L12 23 L20 25 L29 14 L38 19 L47 8 L55 14 L63 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ============================================================
   LEGEND
============================================================ */

export function Legend({
  label,
  className,
  active = true,
  onClick,
}: {
  label: string;
  className: string;
  /** a legend entry is also the series filter: inactive series dim rather than vanish */
  active?: boolean;
  onClick?: () => void;
}) {
  const dot = <span className={`size-2.5 shrink-0 rounded-full ${className}`} aria-hidden />;
  if (!onClick) {
    return (
      <span className={`flex items-center gap-1.5 ${active ? "" : "opacity-50"}`}>
        {dot}
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-all hover:bg-[var(--muted)]/60 ${
        active ? "opacity-100" : "opacity-50"
      }`}
    >
      {dot}
      <span>{label}</span>
    </button>
  );
}

/* ============================================================
   CONVERSATION CHART
============================================================ */

/**
 * Measure a container so an SVG chart can redraw at the panel's size.
 *
 * A viewBox alone does not solve this: `meet` scales the picture uniformly and letterboxes the
 * leftover room, so a taller panel would show the same 620×240 chart with empty space above and
 * below. Grafana redraws; so does this.
 */
export function useChartSize(fallbackWidth = 620, fallbackHeight = 240) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: fallbackWidth, h: fallbackHeight });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 20 || box.height < 40) return;
      setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function ConversationChart({
  data, width: boxWidth, height: boxHeight,
  visible = { total: true, resolved: true, escalated: true },
}: {
  data: { day: string; total: number; resolved: number; escalated: number }[];
  width?: number;
  height?: number;
  /** which series the legend left on; hidden lines do not draw, the axis still fits the data */
  visible?: { total: boolean; resolved: boolean; escalated: boolean };
}) {
  // v0.21.84 — dynamic Y scale (was hardcoded 400): nearest "nice" ceiling
  // v1.5.3 — headroom reduced to 10% and "nice" step aligned to data magnitude
  // (a single spike no longer visually dwarfs the rest of the week)
  // #9 — tick labels used to land on values like 18 / 35 / 53 because max was
  // rounded to a power-of-ten step and then quartered. Pick a NICE step first and
  // derive the ceiling from it, so every gridline is a round number.
  const dataMax = Math.max(10, ...data.flatMap((d) => [d.total, d.resolved, d.escalated]));
  const niceStep = niceTickStep(dataMax / 4);
  const max = niceStep * 4;

  const width = Math.max(320, Math.round(boxWidth ?? 620));
  const height = Math.max(96, Math.round(boxHeight ?? 240));

  const left = 40;
  const right = 15;
  const top = 15;
  const bottom = 35;

  const chartWidth =
    width - left - right;

  const chartHeight =
    height - top - bottom;

  const xAt = (index: number) =>
    left + (data.length > 1 ? (index / (data.length - 1)) * chartWidth : chartWidth / 2);

  const yAt = (value: number) => top + chartHeight - (value / max) * chartHeight;

  function points(key: "total" | "resolved" | "escalated") {
    return data.map((item, index) => `${xAt(index)},${yAt(item[key])}`).join(" ");
  }

  // The reference board reads one day at a time; hovering a day column shows its three
  // numbers instead of making the reader compare a line against the axis by eye.
  const [hover, setHover] = useState<number | null>(null);

  return (
    /* The card owns the height now, so the chart fills whatever is left. `meet` scales it
       UNIFORMLY rather than stretching the axis labels out of shape. */
    <div className="relative mt-2 min-h-0 w-full flex-1 overflow-hidden">

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHover(null)}
      >

        {/* Grid */}

        {[0, 0.25, 0.5, 0.75, 1].map(
          (frac) => {
            const value = Math.round(max * frac);
            const y = yAt(value);

            return (
              <g key={value}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                  opacity="0.55"
                  className="text-slate-200 dark:text-slate-700"
                />

                <text
                  x="5"
                  y={y + 3}
                  fontSize="10"
                  className="fill-slate-400"
                >
                  {value}
                </text>
              </g>
            );
          }
        )}

        {/* Hover guide */}
        {hover !== null && (
          <line
            x1={xAt(hover)}
            x2={xAt(hover)}
            y1={top}
            y2={top + chartHeight}
            stroke="currentColor"
            strokeWidth="1"
            opacity="0.35"
            className="text-[var(--primary)]"
          />
        )}

        {/* Total */}

        {visible.total && (
          <polyline
            points={points("total")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--primary)]"
          />
        )}

        {/* Resolved */}

        {visible.resolved && (
          <polyline
            points={points("resolved")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--ok)]"
          />
        )}

        {/* Escalated */}

        {visible.escalated && (
          <polyline
            points={points("escalated")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[var(--warn)]"
          />
        )}

        {/* Points */}

        {data.map((item, index) => (
          <g key={item.day}>
            {visible.total && (
              <circle cx={xAt(index)} cy={yAt(item.total)} r={hover === index ? 5 : 3} className="fill-[var(--primary)] transition-all" />
            )}
            {visible.resolved && item.resolved > 0 && (
              <circle cx={xAt(index)} cy={yAt(item.resolved)} r={hover === index ? 4 : 2.5} className="fill-[var(--ok)] transition-all" />
            )}
            {visible.escalated && item.escalated > 0 && (
              <circle cx={xAt(index)} cy={yAt(item.escalated)} r={hover === index ? 4 : 2.5} className="fill-[var(--warn)] transition-all" />
            )}
          </g>
        ))}

        {/* X labels */}

        {data.map(
          (item, index) => (
              <text
                key={item.day}
                x={xAt(index)}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                className={hover === index ? "fill-[var(--foreground)] font-semibold" : "fill-slate-400"}
              >
                {item.day}
              </text>
          )
        )}

        {/* Hover columns: one transparent band per day, so the tooltip works anywhere on
            the column and not only on a 3px dot. */}
        {data.map((item, index) => {
          const band = chartWidth / Math.max(1, data.length - 1);
          return (
            <rect
              key={`hit-${item.day}`}
              x={xAt(index) - band / 2}
              y={top}
              width={band}
              height={chartHeight}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          );
        })}

      </svg>

      {hover !== null && data[hover] && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-36 rounded-lg border border-[var(--border)] bg-[var(--popover)] p-2 text-2xs shadow-lg"
          style={{
            left: `${Math.min(78, Math.max(4, ((xAt(hover) / width) * 100) - 9))}%`,
          }}
          role="status"
        >
          <p className="border-b border-[var(--border)] pb-1 font-semibold">{data[hover].day}</p>
          <p className="mt-1 flex justify-between gap-2 text-[var(--primary)]">
            <span>Total</span>
            <span className="font-semibold tabular-nums">{data[hover].total}</span>
          </p>
          <p className="flex justify-between gap-2 text-[var(--ok)]">
            <span>Resolved</span>
            <span className="font-semibold tabular-nums">{data[hover].resolved}</span>
          </p>
          <p className="flex justify-between gap-2 text-[var(--warn)]">
            <span>Escalated</span>
            <span className="font-semibold tabular-nums">{data[hover].escalated}</span>
          </p>
        </div>
      )}

    </div>
  );
}

/* ============================================================
   DONUT
============================================================ */

export function DonutChart({ stats }: { stats: Record<string, number> | null }) {
  const circumference = 2 * Math.PI * 70;

  // v0.21.84 — real escalation rate instead of a hardcoded mock
  const total = stats?.total_conversations ?? 0;
  const escalated = stats?.escalated_to_tickets ?? 0;
  const percentage = total > 0 ? Math.min(100, Math.round((escalated / total) * 1000) / 10) : 0;

  const dash =
    (percentage / 100) *
    circumference;

  // v1.5.3 — no conversations yet → calm empty state instead of a 0% donut
  if (total === 0) {
    return (
      <div className="flex size-44 flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-slate-200 dark:border-slate-800">
        <span className="text-2xl font-semibold text-muted-foreground">—</span>
        <span className="text-2xs text-muted-foreground">No data yet</span>
      </div>
    );
  }

  return (
    <div className="relative size-44">

      <svg
        viewBox="0 0 180 180"
        className="-rotate-90"
      >

        <circle
          cx="90"
          cy="90"
          r="70"
          stroke="currentColor"
          strokeWidth="16"
          fill="none"
          className="text-slate-200 dark:text-slate-800"
        />

        <circle
          cx="90"
          cy="90"
          r="70"
          stroke="currentColor"
          strokeWidth="16"
          fill="none"
          strokeDasharray={`${dash} ${circumference}`}
          strokeLinecap="butt"
          className="text-[var(--warn)]"
        />

      </svg>

      <div className="absolute inset-0 grid place-items-center text-center">

        <div>
          <div className="text-2xl font-semibold">
            {percentage}%
          </div>

          <div className="text-2xs text-muted-foreground">
            Escalation rate
          </div>
        </div>

      </div>

    </div>
  );
}

/* ============================================================
   ESCALATION ROW
============================================================ */

export function GateTrendChart({
  data,
}: {
  data: { day: string; answered: number; cautioned: number }[];
}) {
  // #9 — same nice-step treatment as the conversation chart.
  const dataMax = Math.max(10, ...data.flatMap((d) => [d.answered, d.cautioned]));
  const max = niceTickStep(dataMax / 4) * 4;

  const width = 1000;
  /* v1.6.70 — the plot was 200 tall on a 1000-wide viewBox, so at full page width the
     chart alone was ~270px. The dashboard now has to fit one screen, and the card gives
     this chart ~100px, so the viewBox is flatter (1000×130): it scales uniformly to fill
     that box instead of being letterboxed down to half of it. */
  const height = 130;
  const left = 36;
  const right = 12;
  const top = 8;
  const bottom = 20;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;

  function pts(key: "answered" | "cautioned") {
    return data
      .map((d, i) => {
        const x = left + (i / Math.max(1, data.length - 1)) * chartWidth;
        const y = top + chartHeight - (d[key] / max) * chartHeight;
        return `${x},${y}`;
      })
      .join(" ");
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-full w-full" preserveAspectRatio="xMidYMid meet">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line
            x1={left} x2={width - right}
            y1={top + chartHeight - f * chartHeight}
            y2={top + chartHeight - f * chartHeight}
            stroke="currentColor" className="text-slate-200 dark:text-slate-800"
            strokeWidth="1"
          />
          <text
            x={left - 6}
            y={top + chartHeight - f * chartHeight + 3}
            textAnchor="end"
            className="fill-slate-400 text-2xs"
          >
            {Math.round(f * max)}
          </text>
        </g>
      ))}
      <polyline
        points={pts("answered")}
        fill="none" stroke="#10b981" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
      <polyline
        points={pts("cautioned")}
        fill="none" stroke="#f59e0b" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round"
      />
      {data.map((d, i) => {
        const x = left + (i / Math.max(1, data.length - 1)) * chartWidth;
        return (
          <text
            key={d.day}
            x={x} y={height - 8}
            textAnchor="middle"
            className="fill-slate-400 text-2xs"
          >
            {d.day}
          </text>
        );
      })}
    </svg>
  );
}
