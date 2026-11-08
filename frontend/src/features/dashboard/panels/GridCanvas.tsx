/**
 * GridCanvas — the positionable board.
 *
 * Panels are absolutely positioned in a 12-column grid of fixed rows, so a panel has a place
 * as well as a size. Dragging the header moves it, dragging the bottom-right corner resizes it,
 * and both modes show a dashed ghost of the target cell (Grafana's affordance) before anything
 * is committed.
 *
 * The live feedback is imperative on purpose: a pointermove that re-rendered every chart on
 * the board would make dragging feel broken on a laptop. React only re-renders once, on drop,
 * with the new geometry; the intermediate frames are a transform and a moved ghost.
 *
 * Below `sm` the board is not a grid at all — panels stack in reading order, because a 12-column
 * canvas on a phone is a column of clipped cards.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { COLS, ROW_H, cellStyle, gridRows, layoutCells, movePanelTo, resizePanelTo, type Cell } from "./grid";
import type { PanelSpec } from "./types";

export type DragHandlers = {
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  /** True below `sm`, where panels stack and size to their content instead of to grid rows. */
  stacked: boolean;
};

type Mode = "move" | "resize";

export function GridCanvas({
  panels,
  editing,
  onChange,
  children,
}: {
  panels: PanelSpec[];
  editing: boolean;
  onChange: (next: PanelSpec[]) => void;
  children: (panel: PanelSpec, index: number, handles: DragHandlers) => ReactNode;
}) {
  const board = useRef<HTMLDivElement | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    id: string;
    mode: Mode;
    start: Cell;
    preview?: Cell;
    startX: number;
    startY: number;
    el: HTMLElement | null;
  } | null>(null);

  const cells = useMemo(() => layoutCells(panels), [panels]);
  const rows = gridRows(cells);

  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function"
      ? true
      : window.matchMedia("(min-width: 640px)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  useEffect(() => {
    function move(e: PointerEvent) {
      const state = drag.current;
      const rect = board.current?.getBoundingClientRect();
      if (!state || !rect || !ghost.current) return;
      const colW = rect.width / COLS;
      const dx = Math.round((e.clientX - state.startX) / colW);
      const dy = Math.round((e.clientY - state.startY) / ROW_H);

      const next: Cell =
        state.mode === "move"
          ? {
              ...state.start,
              x: Math.max(0, Math.min(COLS - state.start.w, state.start.x + dx)),
              y: Math.max(0, state.start.y + dy),
            }
          : {
              ...state.start,
              w: Math.max(3, Math.min(COLS - state.start.x, state.start.w + dx)),
              h: Math.max(2, Math.min(12, state.start.h + dy)),
            };
      state.preview = next;

      ghost.current.hidden = false;
      const style = cellStyle(next);
      ghost.current.style.left = style.left;
      ghost.current.style.width = style.width;
      ghost.current.style.top = `${style.top}px`;
      ghost.current.style.height = `${style.height}px`;

      if (state.el) {
        state.el.style.transform = `translate(${dx * colW}px, ${dy * ROW_H}px)`;
        state.el.style.zIndex = "40";
      }
    }

    function up() {
      const state = drag.current;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      if (ghost.current) ghost.current.hidden = true;
      if (!state) return;
      const el = state.el;
      el?.style.removeProperty("transform");
      el?.style.removeProperty("z-index");
      drag.current = null;
      const preview = state.preview;
      if (!preview) return;
      // A click that never moved is not an edit — do not rewrite a layout for nothing.
      if (preview.x === state.start.x && preview.y === state.start.y &&
          preview.w === state.start.w && preview.h === state.start.h) return;
      onChange(
        state.mode === "move"
          ? movePanelTo(panels, state.id, preview.x, preview.y)
          : resizePanelTo(panels, state.id, preview.w, preview.h),
      );
    }

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [panels, onChange]);

  function begin(e: React.PointerEvent, cell: Cell, mode: Mode) {
    if (!editing) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const holder = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-cell-id]");
    drag.current = { id: cell.id, mode, start: { ...cell }, startX: e.clientX, startY: e.clientY, el: holder };
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
  }

  if (!desktop) {
    return (
      <div className="flex flex-col gap-4" data-dashboard-stack>
        {panels.map((panel, index) =>
          children(panel, index, {
            onDragStart: () => {},
            onResizeStart: () => {},
            stacked: true,
          }),
        )}
      </div>
    );
  }

  return (
    <div
      ref={board}
      className="relative w-full"
      style={{ height: rows * ROW_H }}
      data-dashboard-grid
      data-rows={rows}
    >
      {panels.map((panel, index) => {
        const cell = cells.find((c) => c.id === panel.id);
        if (!cell) return null;
        return (
          <div
            key={panel.id}
            data-cell-id={panel.id}
            data-cell={`${cell.x},${cell.y},${cell.w},${cell.h}`}
            className="absolute min-w-0 transition-[left,top,width,height] duration-150"
            style={cellStyle(cell)}
          >
            {children(panel, index, {
              onDragStart: (e) => begin(e, cell, "move"),
              onResizeStart: (e) => begin(e, cell, "resize"),
              stacked: false,
            })}
          </div>
        );
      })}

      {editing && (
        <div
          ref={ghost}
          hidden
          aria-hidden
          className="pointer-events-none absolute z-30 rounded-2xl border-2 border-dashed border-[var(--primary)] bg-[var(--primary)]/10 transition-none"
        />
      )}
    </div>
  );
}
