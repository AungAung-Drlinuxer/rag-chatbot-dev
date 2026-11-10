/**
 * Report output for the admin tables: CSV and a printable sheet.
 *
 * Both take the *filtered* rows, not the visible page — an operator who filtered to a date
 * range and hit Export expects the range, not ten rows of it. The print sheet is a separate
 * window with its own minimal CSS rather than `window.print()` on the app: printing the app
 * prints the sidebar, the pager and the notification bell over the table.
 */

export type ReportColumn = { key: string; label: string; width?: string };

function cell(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function toCsv(columns: ReportColumn[], rows: Record<string, unknown>[]): string {
  const escape = (v: unknown) => `"${String(v ?? "").replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
  const head = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => escape(r[c.key])).join(","));
  // BOM: Excel on Windows reads a UTF-8 CSV without it as mojibake — and this data is Burmese
  // as often as it is English.
  return "\ufeff" + [head, ...body].join("\r\n");
}

/** Raw-text download with the same BOM/UTF-8 handling as the CSVs. */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, columns: ReportColumn[], rows: Record<string, unknown>[]) {
  const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick: Safari cancels the download if the URL dies too early.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printReport({
  title,
  subtitle,
  columns,
  rows,
  sections = [],
  kpis = [],
  meta = [],
  brand,
}: {
  title: string;
  subtitle?: string;
  columns?: ReportColumn[];
  rows?: Record<string, unknown>[];
  /** Extra titled tables below the first one (the dashboard's three panels). */
  sections?: { title: string; columns: ReportColumn[]; rows: Record<string, unknown>[] }[];
  /** Headline numbers printed above the tables, in a row. */
  kpis?: { label: string; value: string }[];
  meta?: string[];
  brand?: string;
}) {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const stamped = new Date().toLocaleString();
  const mainRows = rows ?? [];
  const table = (cols: ReportColumn[], data: Record<string, unknown>[]) => `
<table><thead><tr>${cols.map((c) => `<th${c.width ? ` style="width:${c.width}"` : ""}>${esc(c.label)}</th>`).join("")}</tr></thead>
<tbody>${data.length
    ? data.map((r) => `<tr>${cols.map((c) => `<td>${esc(cell(r[c.key]))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${cols.length}" class="empty">No rows in this range</td></tr>`}</tbody>
</table>`;
  const totalRows = mainRows.length + sections.reduce((n, x) => n + x.rows.length, 0);

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 -apple-system, "Segoe UI", Roboto, "Noto Sans Myanmar", sans-serif; color: #111; margin: 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
  h1 { font-size: 16px; margin: 0; letter-spacing: -0.01em; }
  .brand { font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: #555; }
  .sub { color: #555; font-size: 10px; margin-top: 2px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 10px; font-size: 10px; color: #333; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #444;
             border-bottom: 1px solid #999; padding: 4px 6px; }
  tbody td { padding: 4px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; word-break: break-word; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  td.empty { color: #777; text-align: center; padding: 12px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #333; margin: 14px 0 4px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
  .kpi { border: 1px solid #bbb; border-radius: 6px; padding: 6px 12px; display: flex; flex-direction: column; }
  .kpi b { font-size: 15px; }
  .kpi span { font-size: 9px; color: #555; text-transform: uppercase; letter-spacing: .06em; }
  footer { margin-top: 10px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
  @media print { thead { display: table-header-group; } tr { break-inside: avoid; } }
</style></head><body>
<header>
  <div><h1>${esc(title)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ""}</div>
  <div class="brand">${esc(brand || document.title)}</div>
</header>
<div class="meta">
  ${meta.map((m) => `<span>${esc(m)}</span>`).join("")}
  <span>Printed <b>${esc(stamped)}</b></span>
  <span><b>${totalRows}</b> row${totalRows === 1 ? "" : "s"}</span>
</div>
${kpis.length ? `<div class="kpis">${kpis.map((k) => `<div class="kpi"><b>${esc(k.value)}</b><span>${esc(k.label)}</span></div>`).join("")}</div>` : ""}
${columns && columns.length ? table(columns, mainRows) : ""}
${sections.map((sec) => `<h2>${esc(sec.title)}</h2>${table(sec.columns, sec.rows)}`).join("")}
<footer><span>${esc(title)}</span><span>${esc(subtitle || "")}</span></footer>
</body></html>`;

  const w = window.open("", "_blank", "width=1100,height=760");
  if (!w) return false; // popup blocked — the caller can say so
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  // Give the browser a beat to lay the table out, then open the print dialog.
  window.setTimeout(() => {
    try {
      w.print();
    } catch {
      /* user closed the window before printing — nothing to do */
    }
  }, 250);
  return true;
}
