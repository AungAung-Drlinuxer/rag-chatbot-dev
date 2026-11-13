/**
 * The board surface: a 12-column grid rendered from rectangles, with drag and resize done
 * with pointer events.
 *
 * This used to wrap react-grid-layout. That library kept re-announcing its own layout to a
 * `layout` prop we kept rebuilding, and on the real 8-panel board it settled into a loop that
 * pinned the CPU — the board visibly reshuffled and, after a refresh, appeared to fall back to
 * the defaults. The whole placement problem is arithmetic we already own (`gridLayout.ts`), so
 * the grid is positioned directly: one absolutely placed box per panel, pointer-driven move
 * and resize, and nothing that can feed its own output back into itself.
 *
 * Behaviour follows a Grafana dashboard, which is what people already know:
 *  - the panel follows the pointer pixel-for-pixel while it is held, and a dashed outline shows
 *    the cell it will land in, so the drop is never a surprise;
 *  - there is no gravity. A panel dropped in the middle of the board stays where it was put,
 *    gaps and all — nothing is compacted upward behind the user's back;
 *  - a panel only moves out of the way when another is actually dropped on it, and it moves
 *    the minimum distance down;
 *  - the whole panel is a drag target while arranging, not a 20px strip, and the edges resize.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  GRID_COLS,
  GRID_GAP,
  GRID_ROW_HEIGHT,
  MAX_H,
  MIN_H,
  MIN_W,
  pushDownRects,
  type PanelRect,
  type PanelRects,
} from "@/features/dashboard/lib/gridLayout";

type Props = {
  panels: readonly { id: string }[];
  rects: PanelRects;
  editing: boolean;
  /** Committed geometry after a drag or resize. */
  onChange: (next: PanelRects) => void;
  children: (id: string) => React.ReactNode;
};

type Mode = "move" | "resize-se" | "resize-e" | "resize-s";

type DragState = {
  id: string;
  mode: Mode;
  startX: number;
  startY: number;
  from: PanelRect;
};

/** Pixel offset the held panel is painted at, before it snaps on release. */
type Live = { id: string; dx: number; dy: number; mode: Mode };

/** How many grid cells a pixel offset covers, rounded to the nearest boundary. */
function cells(delta: number, cell: number) {
  return Math.round(delta / (cell + GRID_GAP));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Elements that must keep their own click/drag behaviour inside a panel. */
const INTERACTIVE = "button, a, input, select, textarea, label, [role='button'], [data-no-drag], svg";

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

  /** Snapped geometry while a drag is in flight (draws the ghost and pushes neighbours). */
  const [draft, setDraft] = useState<PanelRects | null>(null);
  /** Raw pointer offset, so the held panel tracks the cursor instead of jumping cell to cell. */
  const [live, setLive] = useState<Live | null>(null);

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
      setLive(null);
    }
  }, [editing]);

  const begin = useCallback(
    (e: React.PointerEvent, id: string, mode: Mode, fromBody: boolean) => {
      if (!editing) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      /* On a touch screen the body must stay scrollable; only the header grabs the finger. */
      if (fromBody && e.pointerType !== "mouse") return;
      if (fromBody) {
        const el = e.target as HTMLElement;
        const hit = el.closest(INTERACTIVE);
        if (hit && !hit.closest("[data-drag-handle]")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      /* Pointer capture keeps the drag alive when the pointer crosses the panel edge — and
         gives us `lostpointercapture`, the only reliable signal that the button was released
         somewhere the window never hears about (over browser chrome, another display). */
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* no capture available: the window listeners still carry the drag */
      }
      const from = { ...(rectsRef.current[id] ?? { x: 0, y: 0, w: 4, h: 6 }) };
      drag.current = { id, mode, startX: e.clientX, startY: e.clientY, from };
      setDraft({ ...rectsRef.current, [id]: from });
      setLive({ id, dx: 0, dy: 0, mode });
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
      const dxPx = e.clientX - d.startX;
      const dyPx = e.clientY - d.startY;
      const dx = cells(dxPx, colWidthRef.current);
      const dy = cells(dyPx, GRID_ROW_HEIGHT);
      const r = { ...d.from };

      if (d.mode === "move") {
        r.x = clamp(d.from.x + dx, 0, GRID_COLS - r.w);
        r.y = Math.max(0, d.from.y + dy);
      } else {
        if (d.mode === "resize-se" || d.mode === "resize-e") {
          r.w = clamp(d.from.w + dx, MIN_W, GRID_COLS - d.from.x);
        }
        if (d.mode === "resize-se" || d.mode === "resize-s") {
          r.h = clamp(d.from.h + dy, MIN_H, MAX_H);
        }
      }

      setLive({ id: d.id, dx: dxPx, dy: dyPx, mode: d.mode });
      setDraft((cur) => {
        const base = { ...(cur ?? rectsRef.current), [d.id]: r };
        /* Only a held panel makes room for itself; nothing re-flows while the pointer moves,
           which is what made the board feel like it was fighting the drag. */
        return d.mode === "move" ? base : base;
      });
    };

    const up = () => {
      const d = drag.current;
      const cur = draftRef.current;
      drag.current = null;
      setDraft(null);
      setLive(null);
      if (!d || !cur) return;
      /* No compaction: the drop is the layout. Panels the user actually landed on are pushed
         down just far enough to stop overlapping. */
      const next = pushDownRects(cur, d.id);
      const changed = Object.keys(next).some((id) => {
        const a = next[id];
        const b = rectsRef.current[id];
        return !b || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
      });
      if (changed) onChange(next);
    };

    /* Escape puts the panel back where it was picked up, as it does in a Grafana edit. */
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      /* `rects` was never touched during the drag, so dropping the preview is the undo. */
      drag.current = null;
      setDraft(null);
      setLive(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    document.addEventListener("lostpointercapture", up, true);
    window.addEventListener("blur", up);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.removeEventListener("lostpointercapture", up, true);
      window.removeEventListener("blur", up);
      window.removeEventListener("keydown", key);
    };
  }, [draft, onChange]);

  const shown = draft ?? rects;

  const geometry = useMemo(() => {
    const rows = Math.max(12, ...Object.values(shown).map((r) => r.y + r.h));
    return { height: rows * GRID_ROW_HEIGHT + (rows - 1) * GRID_GAP };
  }, [shown]);

  const box = (r: PanelRect): React.CSSProperties => ({
    left: r.x * (colWidth + GRID_GAP),
    top: r.y * (GRID_ROW_HEIGHT + GRID_GAP),
    width: r.w * colWidth + (r.w - 1) * GRID_GAP,
    height: r.h * GRID_ROW_HEIGHT + (r.h - 1) * GRID_GAP,
  });

  const ghostId = live && live.mode === "move" ? live.id : null;
  const ghostRect = ghostId ? shown[ghostId] : null;

  return (
    <div
      ref={hostRef}
      className={`board-surface${editing ? " board-surface--editing" : ""}`}
      style={{ height: geometry.height }}
    >
      {editing && ghostRect && (
        <div className="board-surface__ghost" style={box(ghostRect)} aria-hidden />
      )}

      {panels.map((panel) => {
        const r = shown[panel.id];
        if (!r) return <div key={panel.id} data-panel={panel.id} hidden />;
        const held = live?.id === panel.id;
        const style: React.CSSProperties = {
          ...box(r),
          ...(held ? { transform: `translate3d(${live.dx}px, ${live.dy}px, 0)` } : null),
        };
        return (
          <div
            key={panel.id}
            data-panel={panel.id}
            className={`board-surface__item${held ? " board-surface__item--dragging" : ""}`}
            style={style}
            onPointerDown={(e) => begin(e, panel.id, "move", true)}
          >
            <div className="board-surface__body">{children(panel.id)}</div>
            {editing && (
              <>
                <span
                  data-drag-handle
                  className="board-surface__grip"
                  onPointerDown={(e) => begin(e, panel.id, "move", false)}
                  aria-label="Move panel"
                  role="button"
                  tabIndex={-1}
                >
                  <span className="board-surface__grip-dots" aria-hidden />
                </span>
                <span
                  className="board-surface__resize board-surface__resize--e"
                  onPointerDown={(e) => begin(e, panel.id, "resize-e", false)}
                  aria-label="Resize panel width"
                  role="button"
                  tabIndex={-1}
                />
                <span
                  className="board-surface__resize board-surface__resize--s"
                  onPointerDown={(e) => begin(e, panel.id, "resize-s", false)}
                  aria-label="Resize panel height"
                  role="button"
                  tabIndex={-1}
                />
                <span
                  className="board-surface__resize board-surface__resize--se"
                  onPointerDown={(e) => begin(e, panel.id, "resize-se", false)}
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
