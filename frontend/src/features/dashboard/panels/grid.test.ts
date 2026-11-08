/**
 * The board's geometry, without a DOM.
 *
 * These pin the rules the drag interaction relies on: a saved layout without positions still
 * loads as the old board, a drop never overlaps, a collision pushes down (never sideways), and
 * everything floats up so dragging leaves no permanent hole.
 */
import { describe, expect, it } from "vitest";

import {
  COLS, MIN_H, MIN_W, gridRows, layoutCells, movePanelTo, normaliseLayout, overlaps, resizePanelTo,
} from "@/features/dashboard/panels/grid";
import type { PanelSpec } from "@/features/dashboard/panels/types";

function panel(id: string, span: number, extra: Partial<PanelSpec> = {}): PanelSpec {
  return { id, type: "note", title: id, span, options: {}, ...extra };
}

function expectNoOverlap(panels: PanelSpec[]) {
  const cells = layoutCells(panels);
  for (let i = 0; i < cells.length; i += 1) {
    for (let j = i + 1; j < cells.length; j += 1) {
      expect(overlaps(cells[i], cells[j])).toBe(false);
    }
  }
}

function expectCompact(panels: PanelSpec[]) {
  const cells = layoutCells(panels);
  for (const cell of cells) {
    if (cell.y === 0) continue;
    const above = { ...cell, y: cell.y - 1 };
    expect(cells.some((other) => other.id !== cell.id && overlaps(above, other))).toBe(true);
  }
}

describe("layoutCells", () => {
  it("gives a legacy layout (no positions) the same stacked arrangement", () => {
    const cells = layoutCells([
      panel("a", 12, { h: 2 }), panel("b", 6, { h: 2 }),
      panel("c", 6, { h: 2 }), panel("d", 4, { h: 2 }),
    ]);
    expect(cells.map((c) => [c.id, c.x, c.y, c.w, c.h])).toEqual([
      ["a", 0, 0, 12, 2],
      ["b", 0, 2, 6, 2],
      ["c", 6, 2, 6, 2],
      ["d", 0, 4, 4, 2],
    ]);
    expect(gridRows(cells)).toBe(6);
  });

  it("keeps explicit positions and pushes a stale one down when it no longer fits", () => {
    const cells = layoutCells([
      panel("wide", 12, { x: 0, y: 0, h: 2 }),
      panel("small", 6, { x: 6, y: 2, h: 3 }),
      panel("moved", 12, { x: 0, y: 2, h: 2 }), // full width where `small` sits -> slides down
    ]);
    expectNoOverlap([panel("wide", 12), panel("small", 6), panel("moved", 12)]);
    expect(cells.find((c) => c.id === "moved")!.y).toBeGreaterThanOrEqual(5);
  });

  it("clamps widths and heights into the usable range", () => {
    const [cell] = layoutCells([panel("tiny", 1, { h: 99 })]);
    expect(cell.w).toBe(MIN_W);
    expect(cell.h).toBe(12);
  });
});

describe("movePanelTo", () => {
  it("lands beside a neighbour and never overlaps it", () => {
    const start = normaliseLayout([panel("a", 6, { h: 2 }), panel("b", 6, { h: 2 }), panel("c", 6, { h: 2 })]);
    const moved = movePanelTo(start, "c", 6, 0);
    expectNoOverlap(moved);
    const cells = layoutCells(moved);
    expect(cells.find((c) => c.id === "c")).toMatchObject({ x: 6, y: 0, w: 6 });
  });

  it("pushes the panels it lands on downwards, in their own columns", () => {
    const start = normaliseLayout([panel("a", 6, { h: 3 }), panel("b", 6, { h: 3 }), panel("c", 6, { h: 3 })]);
    const moved = movePanelTo(start, "c", 0, 0); // onto `a`
    const cells = layoutCells(moved);
    expectNoOverlap(moved);
    expect(cells.find((c) => c.id === "c")!.y).toBe(0);
    // `a` was pushed below `c`, it did not move to another column.
    expect(cells.find((c) => c.id === "a")).toMatchObject({ x: 0 });
    expect(cells.find((c) => c.id === "a")!.y).toBeGreaterThanOrEqual(3);
  });

  it("floats everything back up after the move", () => {
    const start = normaliseLayout([panel("a", 12, { h: 2 }), panel("b", 12, { h: 2 }), panel("c", 12, { h: 2 })]);
    const moved = movePanelTo(start, "c", 0, 30);
    expectCompact(moved);
    expectNoOverlap(moved);
  });
});

describe("resizePanelTo", () => {
  it("clamps to the minimum panel size", () => {
    const start = normaliseLayout([panel("a", 6, { h: 4 })]);
    const smaller = resizePanelTo(start, "a", 1, 0);
    const cell = layoutCells(smaller)[0];
    expect(cell.w).toBe(MIN_W);
    expect(cell.h).toBe(MIN_H);
  });

  it("pushes the panels the wider panel now covers", () => {
    const start = normaliseLayout([panel("left", 6, { x: 0, y: 0, h: 3 }), panel("right", 6, { x: 6, y: 0, h: 3 })]);
    const wider = resizePanelTo(start, "left", 12, 3);
    expectNoOverlap(wider);
    const cells = layoutCells(wider);
    expect(cells.find((c) => c.id === "left")).toMatchObject({ x: 0, w: 12, y: 0 });
    expect(cells.find((c) => c.id === "right")!.y).toBeGreaterThanOrEqual(3);
  });

  it("never lets a panel run off the right edge", () => {
    const start = normaliseLayout([panel("a", 12)]);
    const out = resizePanelTo(start, "a", COLS + 6, 4);
    expect(layoutCells(out)[0]).toMatchObject({ x: 0, w: COLS });
  });
});

describe("normaliseLayout", () => {
  it("keeps every panel's id and type while adding geometry", () => {
    const out = normaliseLayout([panel("a", 12), panel("b", 6)]);
    expect(out.map((p) => p.id)).toEqual(["a", "b"]);
    expect(out.every((p) => typeof p.x === "number" && typeof p.y === "number" && typeof p.h === "number")).toBe(true);
  });

  it("gives charts more height than a KPI strip", () => {
    const [kpi, chart] = layoutCells([
      { id: "k", type: "kpis", title: "", span: 12, options: {} },
      { id: "t", type: "trend", title: "", span: 12, options: {} },
    ]);
    expect(chart.h).toBeGreaterThan(kpi.h);
  });
});
