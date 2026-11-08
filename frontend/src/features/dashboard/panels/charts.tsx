/**
 * Small chart primitives shared by the usage panels.
 *
 * They are plain divs on design tokens, not a charting library: the board already renders
 * fine without one, and a 300 kB dependency to draw eleven bars would be a poor trade.
 * Every value is labelled — a bar whose height encodes a number the user cannot read is
 * decoration.
 */

export const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-US");

/** A NUMERIC column can arrive as a string; coerce rather than trusting the wire. */
export const fmtCost = (value: number | string) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
};

export const fmtMs = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;

export function BarRow({
  label, value, max, format = fmtInt, title,
}: {
  label: string;
  value: number;
  max: number;
  format?: (n: number) => string;
  title?: string;
}) {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 text-2xs" title={title}>
      <span className="w-24 shrink-0 truncate text-muted-foreground" title={label}>{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
        <span className="block h-full rounded-full bg-[var(--primary)]" style={{ width: `${width}%` }} />
      </span>
      <span className="w-16 shrink-0 text-right font-medium tabular-nums">{format(value)}</span>
    </div>
  );
}

/** Per-day columns; zeros are drawn as a baseline so gaps stay visible. */
export function DayColumns({
  data, pick, format = fmtInt, height = 96,
}: {
  data: { day: string }[];
  pick: (row: any) => number;
  format?: (n: number) => string;
  height?: number;
}) {
  const values = data.map(pick);
  const max = Math.max(...values, 0);
  return (
    <div>
      <div className="flex items-end gap-0.5" style={{ height }}>
        {data.map((d) => {
          const v = pick(d);
          const h = max > 0 ? Math.max(v > 0 ? 4 : 0, Math.round((v / max) * 100)) : 0;
          return (
            <div key={d.day} className="group flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${format(v)}`}>
              <span
                className="w-full rounded-t bg-[var(--primary)]/70 transition group-hover:bg-[var(--primary)]"
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
        <span>{data[0]?.day?.slice(5)}</span>
        <span>{data[data.length - 1]?.day?.slice(5)}</span>
      </div>
    </div>
  );
}
