/**
 * PanelFrame — the chrome around one panel.
 *
 * Reading view: the body only. Edit view: a header you can drag, width/height selects, and a
 * bottom-right corner you can pull (Grafana's resize affordance). Chrome appears only while the
 * board is being edited, so the page an operator reads every morning is unchanged.
 *
 * Every pointer gesture has a keyboard/menu equivalent — arrow buttons for position, selects for
 * size — because a layout that can only be arranged with a mouse cannot be arranged by everyone.
 */
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";

import { catalogueFor, panelTitle, type PanelSpec } from "@/features/dashboard/panels/types";
import type { DragHandlers } from "@/features/dashboard/panels/GridCanvas";

type Props = {
  panel: PanelSpec;
  index: number;
  count: number;
  editing: boolean;
  /** False when the board is stacked (phone): panels size to content, not to grid rows. */
  fixedHeight?: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onWidth: (span: number) => void;
  onHeight: (rows: number) => void;
  handles: DragHandlers;
  children: ReactNode;
};

export default function PanelFrame({
  panel, index, count, editing, fixedHeight = true,
  onEdit, onDuplicate, onRemove, onMove, onWidth, onHeight, handles, children,
}: Props) {
  const [hover, setHover] = useState(false);
  const label = panelTitle(panel);
  const known = Boolean(catalogueFor(panel.type));

  return (
    <section
      className={[
        // The panel bodies are already cards (border + radius + padding). The frame must not
        // draw a second one in reading mode, or every panel appears double-bordered.
        "group/panel relative flex min-w-0 flex-col overflow-hidden rounded-2xl transition-colors",
        editing
          ? hover
            ? "border border-[var(--primary)]/60 bg-card ring-2 ring-[var(--primary)]/20"
            : "border border-dashed border-[var(--border)] bg-[var(--panel)]/40"
          : "",
      ].join(" ")}
      style={fixedHeight ? { height: "100%" } : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-panel-id={panel.id}
      data-panel-type={panel.type}
    >
      {editing && (
        <header
          onPointerDown={handles.onDragStart}
          className="flex shrink-0 cursor-grab touch-none select-none items-center gap-1.5 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-1 active:cursor-grabbing"
          title="Drag to move this panel"
          data-drag-handle
        >
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate text-2xs font-semibold text-foreground">{label}</span>
          {!known && (
            <span className="shrink-0 rounded bg-[var(--warn)]/15 px-1 py-0.5 text-[9px] font-medium text-[var(--warn)]">
              unknown type “{panel.type}”
            </span>
          )}

          <span className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label={`Move ${label} left`}
              title="Move left"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onMove(1)}
              disabled={index === count - 1}
              aria-label={`Move ${label} right`}
              title="Move right"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ArrowRight className="size-3.5" aria-hidden />
            </button>

            <select
              value={panel.span}
              onChange={(e) => onWidth(Number(e.target.value))}
              aria-label={`Width of ${label}`}
              title="Width in 12ths"
              className="hidden rounded border border-[var(--border)] bg-card px-1 py-0.5 text-[9.5px] sm:block"
            >
              {[3, 4, 6, 8, 9, 12].map((n) => (
                <option key={n} value={n}>{n}/12</option>
              ))}
            </select>

            <select
              value={panel.h ?? ""}
              onChange={(e) => onHeight(Number(e.target.value))}
              aria-label={`Height of ${label}`}
              title="Height in rows"
              className="hidden rounded border border-[var(--border)] bg-card px-1 py-0.5 text-[9.5px] sm:block"
            >
              {[2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>{n}r</option>
              ))}
            </select>

            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${label}`}
              title="Configure panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              aria-label={`Duplicate ${label}`}
              title="Duplicate panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Copy className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${label}`}
              title="Remove panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </span>
        </header>
      )}

      <div className={["min-h-0 flex-1", fixedHeight ? "overflow-auto" : ""].join(" ")}>
        {children}
      </div>

      {editing && fixedHeight && (
        <span
          onPointerDown={handles.onResizeStart}
          role="separator"
          aria-label={`Resize ${label}`}
          title="Drag to resize"
          className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none"
        >
          <svg viewBox="0 0 16 16" className="size-4 text-muted-foreground/70" aria-hidden>
            <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </span>
      )}
    </section>
  );
}
