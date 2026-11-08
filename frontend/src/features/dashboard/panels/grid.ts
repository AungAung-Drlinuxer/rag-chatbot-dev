/**
 * The Overview board's geometry.
 *
 * A panel used to be a width (`span`) in a CSS grid, so the only things an operator could do
 * were reorder and resize by 1/12 columns. Grafana-like means a panel has a POSITION as well:
 * `{x, y, w, h}` on a 12-column grid of fixed-height rows. Everything here is pure: the grid
 * canvas renders what these functions return, so the drag maths is testable without a DOM.
 *
 * The rules, in order:
 *   1. widths clamp to MIN_SPAN..12 columns, heights to MIN_H..MAX_H rows (a panel shorter than
 *      two rows cannot show a heading and one number);
 *   2. a panel that has no position (a layout saved before this existed) is placed in the first
 *      free slot, in array order — which is exactly the old stacked board;
 *   3. a collision pushes the lower panel down, never sideways, so a drop never scrambles the
 *      columns someone deliberately built;
 *   4. everything then floats up (gravity), like Grafana, so dragging one panel never leaves a
 *      permanent hole behind it.
 */
import type { PanelSpec, PanelType } from "./types";

export const COLS = 12;
/** One grid row in px, gap included. Panels are positioned in whole rows. */
export const ROW_H = 92;
export const MIN_H = 2;
export const MAX_H = 12;
export const MIN_W = 3;

export type Cell = { id: string; x: number; y: number; w: number; h: number };

/** Sensible height per panel type, in rows — a chart needs five, a KPI strip two. */
const DEFAULT_HEIGHT: Partial<Record<PanelType, number>> = {
  attention: 2,
  kpis: 2,
  "usage-kpis": 2,
  trend: 5,
  quality: 5,
  "cost-trend": 5,
  "model-cost": 4,
  "outcome-mix": 4,
  "needs-review": 5,
  "recent-tickets": 5,
  domains: 4,
  knowledge: 3,
  health: 5,
  note: 3,
  "guardrail-events": 4,
};

export function defaultHeightFor(type: string): number {
  return DEFAULT_HEIGHT[type as PanelType] ?? 4;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function overlaps(a: Cell, b: Cell): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function fits(cell: Cell, placed: Cell[]): boolean {
  return cell.x >= 0 && cell.x + cell.w <= COLS && !placed.some((p) => p.id !== cell.id && overlaps(cell, p));
}

function firstFree(w: number, h: number, placed: Cell[]): { x: number; y: number } {
  for (let y = 0; y < 400; y += 1) {
    for (let x = 0; x <= COLS - w; x += 1) {
      if (fits({ id: "_", x, y, w, h }, placed)) return { x, y };
    }
  }
  return { x: 0, y: 400 };
}

/** Float every panel upward, preserving vertical order — Grafana's gravity. */
function compact(cells: Cell[]): Cell[] {
  const order = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Cell[] = [];
  for (const cell of order) {
    let y = 0;
    // The panel takes the first row, top-down, where it does not touch anything already placed.
    while (!fits({ ...cell, y }, placed)) y += 1;
    placed.push({ ...cell, y });
  }
  return placed;
}

/**
 * Push everything out of the way of ONE panel — the one being moved or resized.
 *
 * Direction matters: the panel under the pointer wins the cell it was dropped on, and whoever
 * occupied that cell goes below it. A generic "push the lower one down" pass would instead
 * shove the dragged panel downwards, which is the opposite of what a drop means.
 */
function pushAway(cells: Cell[], anchorId: string): Cell[] {
  const out = cells.map((c) => ({ ...c }));
  const anchor = out.find((c) => c.id === anchorId);
  if (!anchor) return out;
  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false;
    const others = out.filter((c) => c.id !== anchorId).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const other of others) {
      if (overlaps(anchor, other)) {
        other.y = anchor.y + anchor.h;
        moved = true;
      }
    }
    // Cascades: a pushed panel can now sit on a third one.
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        if (overlaps(others[i], others[j])) {
          others[j].y = others[i].y + others[i].h;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return out;
}

/** Positions for every panel, in the order given. */
export function layoutCells(panels: PanelSpec[]): Cell[] {
  const cells: Cell[] = panels.map((p) => ({
    id: p.id,
    x: Number.isFinite(p.x) ? clamp(Number(p.x), 0, COLS - 1) : -1,
    y: Number.isFinite(p.y) ? Math.max(0, Number(p.y)) : -1,
    w: clamp(Number(p.span) || 6, MIN_W, COLS),
    h: clamp(Number(p.h) || defaultHeightFor(p.type), MIN_H, MAX_H),
  }));

  const placed: Cell[] = [];
  for (const cell of cells) {
    if (cell.x >= 0 && cell.y >= 0) {
      const width = clamp(cell.w, MIN_W, COLS);
      const candidate: Cell = { ...cell, w: width, x: clamp(cell.x, 0, COLS - width) };
      // A saved position that no longer fits (a wider panel) slides down instead of vanishing.
      let guard = 0;
      while (!fits(candidate, placed) && guard < 400) {
        candidate.y += 1;
        guard += 1;
      }
      placed.push(candidate);
    } else {
      const spot = firstFree(cell.w, cell.h, placed);
      placed.push({ ...cell, x: spot.x, y: spot.y });
    }
  }
  return compact(placed);
}

/** Write positions back onto the specs (the saved shape is the specs themselves). */
export function withCells(panels: PanelSpec[], cells: Cell[]): PanelSpec[] {
  const byId = new Map(cells.map((c) => [c.id, c]));
  return panels.map((p) => {
    const c = byId.get(p.id);
    return c ? { ...p, span: c.w, x: c.x, y: c.y, h: c.h } : p;
  });
}

export function normaliseLayout(panels: PanelSpec[]): PanelSpec[] {
  return withCells(panels, layoutCells(panels));
}

/** Move one panel to a cell; colliding panels are pushed down, then everything floats up. */
export function movePanelTo(panels: PanelSpec[], id: string, x: number, y: number): PanelSpec[] {
  const cells = layoutCells(panels);
  const target = cells.find((c) => c.id === id);
  if (!target) return panels;
  target.x = clamp(Math.round(x), 0, COLS - target.w);
  target.y = Math.max(0, Math.round(y));
  return withCells(panels, compact(pushAway(cells, id)));
}

/** Resize one panel (in cells); the same push-and-float rules apply. */
export function resizePanelTo(panels: PanelSpec[], id: string, w: number, h: number): PanelSpec[] {
  const cells = layoutCells(panels);
  const target = cells.find((c) => c.id === id);
  if (!target) return panels;
  target.w = clamp(Math.round(w), MIN_W, COLS);
  target.h = clamp(Math.round(h), MIN_H, MAX_H);
  target.x = clamp(target.x, 0, COLS - target.w);
  return withCells(panels, compact(pushAway(cells, id)));
}

export function gridRows(cells: Cell[]): number {
  return cells.reduce((max, c) => Math.max(max, c.y + c.h), 0);
}

/** Pixel geometry for one cell inside a container of `width` px. */
export function cellStyle(cell: Cell, gap = 8) {
  return {
    left: `calc(${(cell.x / COLS) * 100}% + ${gap / 2}px)`,
    width: `calc(${(cell.w / COLS) * 100}% - ${gap}px)`,
    top: cell.y * ROW_H + gap / 2,
    height: cell.h * ROW_H - gap,
  };
}
