/**
 * Grafana-style board geometry.
 *
 * Every panel owns a rectangle `{x, y, w, h}` in a 12-column grid, exactly like a Grafana
 * panel: drag the header to move it, drag any edge to resize it, and the layout compacted
 * upward so holes never accumulate. The band model this replaces ("panels share rows, a row
 * has one height") could not express "this panel is taller than its neighbour", which is the
 * whole point of a dashboard you arrange yourself.
 *
 * All arithmetic is pure so it can be tested without a DOM.
 */

export const GRID_COLS = 12;
export const GRID_ROW_HEIGHT = 30;
export const GRID_GAP = 8;

export const MIN_W = 2;
export const MIN_H = 3;
export const MAX_H = 120;
export const MAX_Y = 4000;

export type PanelRect = { x: number; y: number; w: number; h: number };
export type PanelRects = Record<string, PanelRect>;

export type PanelLike = { id: string; type: string; span: number };

/**
 * Default height per panel type, in grid rows (each row is 30px + 8px gap).
 *
 * These are starting sizes, not limits: every one of them is draggable to any height the
 * user wants, and taller panels scroll their own content instead of stretching the page.
 */
const DEFAULT_H: Record<string, number> = {
  kpis: 4,
  attention: 6,
  "usage-kpis": 8,
  trend: 8,
  quality: 7,
  domains: 7,
  "token-breakdown": 7,
  knowledge: 7,
  health: 7,
  "guardrail-events": 8,
};

/** The layout a user who has never arranged anything gets: the old board, row by row. */
export function defaultRects(panels: readonly PanelLike[]): PanelRects {
  const rects: PanelRects = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const panel of panels) {
    const w = clamp(Math.round(panel.span), MIN_W, GRID_COLS);
    const h = DEFAULT_H[panel.type] ?? 8;
    if (x + w > GRID_COLS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    rects[panel.id] = { x, y, w, h };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return rects;
}

/**
 * Whatever was stored becomes something drawable.
 *
 * A saved board outlives the release that wrote it — a panel may have been removed, a width
 * may have been hand-edited to 99. Unknown ids are dropped, numbers are clamped, overlaps are
 * removed by compaction, and a missing panel is placed where it would have been by default.
 */
export function sanitiseRects(
  raw: unknown,
  panels: readonly PanelLike[],
): PanelRects {
  const fallback = defaultRects(panels);
  const saved = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: PanelRects = {};

  for (const panel of panels) {
    const value = saved[panel.id];
    if (!value || typeof value !== "object") {
      out[panel.id] = { ...fallback[panel.id] };
      continue;
    }
    const r = value as Record<string, unknown>;
    out[panel.id] = {
      x: clamp(number(r.x, fallback[panel.id].x), 0, GRID_COLS - 1),
      y: clamp(number(r.y, 0), 0, MAX_Y),
      w: clamp(number(r.w, fallback[panel.id].w), MIN_W, GRID_COLS),
      h: clamp(number(r.h, fallback[panel.id].h), MIN_H, MAX_H),
    };
  }
  return pushDownRects(out);
}

/**
 * Gravity upward: walk the plan top-to-bottom, left-to-right and drop each rectangle to the
 * highest row where it does not collide.
 *
 * Not used for a user's board any more — a dashboard you arrange yourself keeps the gaps you
 * left, exactly as Grafana does. It survives for the stored-layout repair path and its tests.
 */
export function compactRects(rects: PanelRects): PanelRects {
  const ids = Object.keys(rects);
  const order = ids
    .slice()
    .sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);

  const placed: PanelRects = {};
  for (const id of order) {
    const rect = rects[id];
    let y = 0;
    while (collides({ ...rect, y }, placed)) y += 1;
    placed[id] = { ...rect, y };
  }
  return placed;
}

/**
 * Overlap repair with no gravity: keep every rectangle where it is and only move the ones that
 * are standing on each other, the minimum number of rows down. `anchor` (the panel the user
 * just dropped) is placed first and never moves.
 *
 * This is the difference between "drop it here" and "drop it here and watch the board tidy
 * itself": a gap is a decision, an overlap is an accident.
 */
export function pushDownRects(rects: PanelRects, anchor?: string): PanelRects {
  const ids = Object.keys(rects);
  const order = ids
    .slice()
    .sort((a, b) => rects[a].y - rects[b].y || rects[a].x - rects[b].x);
  if (anchor && order.includes(anchor)) {
    order.splice(order.indexOf(anchor), 1);
    order.unshift(anchor);
  }

  const placed: PanelRects = {};
  for (const id of order) {
    const rect = { ...rects[id] };
    if (id !== anchor) {
      let guard = 0;
      while (collides(rect, placed) && guard < MAX_Y) {
        rect.y += 1;
        guard += 1;
      }
    }
    placed[id] = rect;
  }
  return placed;
}

/**
 * Widen every panel to the right until it meets a neighbour or the grid edge.
 *
 * The user-facing name is "Fit to width": after someone drags a panel narrower, the row keeps a
 * hole that no drag can fill without moving everything else. This closes those holes in place —
 * heights, order and vertical gaps are untouched, so nothing the user arranged moves.
 */
export function fitWidth(rects: PanelRects): PanelRects {
  /* Widening assumes the starting board is already legal; a stored layout that was damaged (or a
     caller that hand-built one) is repaired first so a hole-filling pass can never create an
     overlap. */
  const base = hasOverlap(rects) ? pushDownRects(rects) : rects;
  const out: PanelRects = {};
  const ids = Object.keys(base).sort(
    (a, b) => base[a].y - base[b].y || base[a].x - base[b].x,
  );
  for (const id of ids) {
    const r = { ...base[id] };
    /* The nearest panel that shares a row band with this one and starts to its right. */
    let right = GRID_COLS;
    for (const otherId of ids) {
      if (otherId === id) continue;
      const o = base[otherId];
      if (o.x <= r.x) continue;
      if (o.y >= r.y + r.h || r.y >= o.y + o.h) continue;
      right = Math.min(right, o.x);
    }
    r.w = clamp(right - r.x, MIN_W, GRID_COLS - r.x);
    out[id] = r;
  }
  return out;
}

/** True when any two rectangles overlap — the invariant every layout operation must preserve. */
export function hasOverlap(rects: PanelRects): boolean {
  const ids = Object.keys(rects);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = rects[ids[i]];
      const b = rects[ids[j]];
      if (
        a.x < b.x + b.w &&
        b.x < a.x + a.w &&
        a.y < b.y + b.h &&
        b.y < a.y + a.h
      ) {
        return true;
      }
    }
  }
  return false;
}

export function collides(rect: PanelRect, placed: PanelRects): boolean {
  return Object.values(placed).some(
    (other) =>
      rect.x < other.x + other.w &&
      other.x < rect.x + rect.w &&
      rect.y < other.y + other.h &&
      other.y < rect.y + rect.h,
  );
}

/** The rectangle list the grid component wants, in panel order. */
export function layoutItems(
  panels: readonly { id: string }[],
  rects: PanelRects,
): Array<{ i: string; x: number; y: number; w: number; h: number; minW: number; minH: number; maxH: number }> {
  return panels.map((panel) => ({
    i: panel.id,
    ...rects[panel.id],
    minW: MIN_W,
    minH: MIN_H,
    maxH: MAX_H,
  }));
}

/** Width in grid columns → CSS percentage, for the static (non-grid) fallback. */
export function spanPercent(w: number): string {
  return `${(clamp(w, 1, GRID_COLS) / GRID_COLS) * 100}%`;
}

function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
