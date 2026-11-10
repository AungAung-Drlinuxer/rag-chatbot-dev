/**
 * The one Print / Export CSV pair for every table in the console.
 *
 * Five pages had grown five versions of this: an icon-only printer here, "Export" there,
 * Print and Export in different orders and different weights, so the same action looked like
 * a different action depending on the page. This fixes the order (Print, then Export CSV),
 * the size (h-8), the weight (Print is secondary, Export is the page's primary fill) and the
 * disabled rule (nothing to report → both disabled) in one place.
 */
import { Download, Printer } from "lucide-react";

export function ReportActions({
  onPrint,
  onExport,
  disabled,
  title = "Export CSV",
}: {
  onPrint: () => void;
  onExport: () => void;
  disabled?: boolean;
  /** Tooltip/sub-label for the export button; the visible label is always "Export CSV". */
  title?: string;
}) {
  const base =
    "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition disabled:opacity-50 disabled:cursor-not-allowed";
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Report actions">
      <button
        type="button"
        onClick={onPrint}
        disabled={disabled}
        aria-label="Print report"
        title="Print report"
        className={`${base} border border-[var(--border)] bg-card font-medium text-foreground hover:bg-[var(--muted)]`}
      >
        <Printer className="size-3.5" />
        Print
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={disabled}
        aria-label="Export CSV"
        title={title}
        className={`${base} bg-[var(--primary)] font-semibold text-[var(--primary-foreground)] shadow-sm hover:opacity-90`}
      >
        <Download className="size-3.5" />
        Export CSV
      </button>
    </div>
  );
}
