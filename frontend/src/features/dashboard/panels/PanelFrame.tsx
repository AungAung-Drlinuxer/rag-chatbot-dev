/**
 * PanelFrame — the chrome around one panel: drag to reorder, resize by span, edit, duplicate,
 * delete. Chrome only appears while the dashboard is in edit mode, so the reading view stays
 * exactly as it was before customization existed.
 *
 * Drag is pointer-based (HTML5 DnD) rather than a grid library, and every drag has a keyboard
 * equivalent (move left/right), because a reorder you can only do with a mouse is a reorder
 * half the operators cannot perform.
 */
import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Copy, GripVertical, Pencil, Trash2 } from "lucide-react";

import { catalogueFor, panelTitle, type PanelSpec } from "@/features/dashboard/panels/types";

type Props = {
  panel: PanelSpec;
  index: number;
  count: number;
  editing: boolean;
  dragging: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDrop: () => void;
  onSpan: (span: number) => void;
  children: ReactNode;
};

export default function PanelFrame({
  panel, index, count, editing, dragging,
  onEdit, onDuplicate, onRemove, onMove, onDragStart, onDrop, onSpan, children,
}: Props) {
  const [over, setOver] = useState(false);
  const label = panelTitle(panel);
  const known = Boolean(catalogueFor(panel.type));

  return (
    <div
      className={[
        "relative min-w-0",
        editing ? "rounded-2xl ring-1 ring-dashed ring-[var(--border)] p-1" : "",
        dragging ? "opacity-40" : "",
        over && editing ? "ring-2 ring-[var(--primary)]" : "",
      ].join(" ")}
      draggable={editing}
      onDragStart={(e) => {
        if (!editing) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", panel.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        if (!editing) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editing) return;
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      data-panel-id={panel.id}
      data-panel-type={panel.type}
    >
      {editing && (
        <div className="mb-1 flex flex-wrap items-center gap-1.5 px-1 text-2xs">
          <span className="flex cursor-grab items-center gap-1 rounded-md bg-[var(--muted)] px-1.5 py-0.5 font-medium text-muted-foreground" title="Drag to reorder">
            <GripVertical className="size-3" /> {label}
          </span>
          {!known && (
            <span className="rounded-md bg-[var(--warn)]/15 px-1.5 py-0.5 font-medium text-[var(--warn)]">
              unknown type “{panel.type}”
            </span>
          )}
          <span className="ml-auto flex items-center gap-0.5">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
              aria-label={`Move ${label} left`} title="Move left"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
              <ArrowLeft className="size-3.5" />
            </button>
            <button type="button" onClick={() => onMove(1)} disabled={index === count - 1}
              aria-label={`Move ${label} right`} title="Move right"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-30">
              <ArrowRight className="size-3.5" />
            </button>
            <span className="mx-1 hidden items-center gap-1 sm:flex">
              <span className="text-muted-foreground">width</span>
              <select
                value={panel.span}
                onChange={(e) => onSpan(Number(e.target.value))}
                aria-label={`Width of ${label}`}
                className="rounded border border-[var(--border)] bg-card px-1 py-0.5 text-2xs"
              >
                {[3, 4, 6, 8, 9, 12].map((n) => (
                  <option key={n} value={n}>{n}/12</option>
                ))}
              </select>
            </span>
            <button type="button" onClick={onEdit} aria-label={`Edit ${label}`} title="Edit panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Pencil className="size-3.5" />
            </button>
            <button type="button" onClick={onDuplicate} aria-label={`Duplicate ${label}`} title="Duplicate panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Copy className="size-3.5" />
            </button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} title="Remove panel"
              className="rounded p-1 text-muted-foreground transition hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]">
              <Trash2 className="size-3.5" />
            </button>
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
