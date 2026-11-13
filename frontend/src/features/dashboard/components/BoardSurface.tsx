/**
 * The board surface: a 12-column grid rendered from rectangles, with drag and resize done
 * with pointer events.
 *
 * This used to wrap react-grid-layout. That library kept re-announcing its own layout to a
 * `layout` prop we kept rebuilding, and on the real 8-panel board it settled into a loop that
 * pinned the CPU — the board visibly reshuffled and, after a refresh, appeared to fall back to
 * the defaults. The whole placement problem is arithmetic we already own (`gridLayout.ts`), so
 * the grid is positioned directly: one absolutely placed box per panel, a grip to drag, one
 * corner to resize, and nothing that can feed its own output back into itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { GRID_COLS, GRID_GAP, GRID_ROW_HEIGHT, compactRects, type PanelRect, type PanelRects } from "@/features/dashboard/lib/gridLayout";

type Props = {
  panels: readonly { id: string }[];
  rects: PanelRects;
  editing: boolean;
  /** Committed geometry after a drag or resize. */
  onChange: (next: PanelRects) => void;
  children: (id: string) => React.ReactNode;
};

const MIN_W = 2;
const MIN_H = 3;
const MAX_H = 40;

/** How many grid cells a pixel offset covers, rounded to the nearest boundary. */
function cells(delta: number, cell: number) {
  return Math.round(delta / (cell + GRID_GAP));
}

type DragState = {
  id: string;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  from: PanelRect;
};

export function BoardSurface({ panels, rects, editing, onChange, children }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const paint = () => {
      const next = Math.round(el.clientWidth);
      setWidth((prev) => (Math.abs(next - prev) < 2 ? prev : next));
    };
    paint();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* A zero-width host (no layout engine, or a hidden tab) would draw nothing at all; fall back
     to a nominal board width and correct on the next paint. */
  const boardWidth = width > 0 ? width : 1120;
  const colWidth = (boardWidth - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

  const [draft, setDraft] = useState<PanelRects | null>(null);
  const drag = useRef<DragState | null>(null);
  /* Read inside the window `pointerup` listener: a state updater must stay pure, and calling
     `onChange` from inside one made React drop the commit (the board kept the draft and never
     went dirty, so "Save view" never appeared). */
  const draftRef = useRef<PanelRects | null>(draft);
  draftRef.current = draft;

  /* The last committed geometry, for the window listeners below (they outlive a render). */
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const colWidthRef = useRef(colWidth);
  colWidthRef.current = colWidth;

  /* Leaving arrange mode discards any half-finished drag: Cancel must not leave a panel
     floating where the pointer happened to stop. */
  useEffect(() => {
    if (!editing) {
      drag.current = null;
      setDraft(null);
    }
  }, [editing]);

  const begin = useCallback(
    (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
      const from = { ...(rectsRef.current[id] ?? { x: 0, y: 0, w: 4, h: 6 }) };
      drag.current = { id, mode, startX: e.clientX, startY: e.clientY, from };
      setDraft({ ...rectsRef.current, [id]: from });
    },
    [editing],
  );

  /* Drag tracking lives on the window: the pointer routinely leaves the grip (and the panel)
     before it is released, and element-level capture made the release easy to miss — which
     left the board stuck mid-drag. */
  useEffect(() => {
    if (!draft) return;

    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = cells(e.clientX - d.startX, colWidthRef.current);
      const dy = cells(e.clientY - d.startY, GRID_ROW_HEIGHT);
      const r = { ...d.from };
      if (d.mode === "move") {
        r.x = Math.min(GRID_COLS - r.w, Math.max(0, d.from.x + dx));
        r.y = Math.max(0, d.from.y + dy);
      } else {
        r.w = Math.min(GRID_COLS - r.x, Math.max(MIN_W, d.from.w + dx));
        r.h = Math.min(MAX_H, Math.max(MIN_H, d.from.h + dy));
      }
      setDraft((cur) => ({ ...(cur ?? rectsRef.current), [d.id]: r }));
    };

    const up = () => {
      const d = drag.current;
      const cur = draftRef.current;
      drag.current = null;
      setDraft(null);
      if (!d || !cur) return;
      const next = compactRects(cur);
      const changed = Object.keys(next).some((id) => {
        const a = next[id];
        const b = rectsRef.current[id];
        return !b || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
      });
      if (changed) onChange(next);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [draft, onChange]);

  const geometry = useMemo(() => {
    const rows = Math.max(12, ...Object.values(draft ?? rects).map((r) => r.y + r.h));
    return { height: rows * GRID_ROW_HEIGHT + (rows - 1) * GRID_GAP };
  }, [draft, rects]);

  const shown = draft ?? rects;

  return (
    <div
      ref={hostRef}
      className={`board-surface${editing ? " board-surface--editing" : ""}`}
      style={{ height: geometry.height }}
    >
      {panels.map((panel) => {
        const r = shown[panel.id];
        if (!r) return <div key={panel.id} data-panel={panel.id} hidden />;
        const style: React.CSSProperties = {
          left: r.x * (colWidth + GRID_GAP),
          top: r.y * (GRID_ROW_HEIGHT + GRID_GAP),
          width: r.w * colWidth + (r.w - 1) * GRID_GAP,
          height: r.h * GRID_ROW_HEIGHT + (r.h - 1) * GRID_GAP,
        };
        return (
          <div key={panel.id} data-panel={panel.id} className="board-surface__item" style={style}>
            <div className="board-surface__body">{children(panel.id)}</div>
            {editing && (
              <>
                <span
                  data-drag-handle
                  className="board-surface__grip"
                  onPointerDown={(e) => begin(e, panel.id, "move")}
                  aria-label="Move panel"
                  role="button"
                  tabIndex={-1}
                />
                <span
                  className="board-surface__resize"
                  onPointerDown={(e) => begin(e, panel.id, "resize")}
                  aria-label="Resize panel"
                  role="button"
                  tabIndex={-1}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
