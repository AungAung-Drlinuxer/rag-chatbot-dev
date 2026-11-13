import { describe, expect, it } from "vitest";

import {
  GRID_COLS,
  MAX_H,
  MIN_H,
  MIN_W,
  compactRects,
  defaultRects,
  layoutItems,
  pushDownRects,
  sanitiseRects,
  spanPercent,
  type PanelLike,
  type PanelRects,
} from "./gridLayout";

const PANELS: PanelLike[] = [
  { id: "kpis", type: "kpis", span: 12 },
  { id: "usage", type: "usage-kpis", span: 6 },
  { id: "trend", type: "trend", span: 6 },
  { id: "domains", type: "domains", span: 3 },
  { id: "tokens", type: "token-breakdown", span: 3 },
  { id: "health", type: "health", span: 3 },
  { id: "workspace", type: "knowledge", span: 3 },
  { id: "guardrails", type: "guardrail-events", span: 12 },
];

describe("defaultRects", () => {
  it("packs panels left to right and starts a new row when one does not fit", () => {
    const rects = defaultRects(PANELS);

    expect(rects.kpis).toMatchObject({ x: 0, y: 0, w: 12 });
    // the 6-wide pair shares the row under it
    expect(rects.usage.y).toBe(rects.trend.y);
    expect(rects.usage.x).toBe(0);
    expect(rects.trend.x).toBe(6);
    // the four 3-wide panels fill the next row
    expect(new Set([rects.domains.y, rects.tokens.y, rects.health.y, rects.workspace.y]).size).toBe(1);
    expect(rects.workspace.x + rects.workspace.w).toBe(GRID_COLS);
    // the full-width tail sits below everything
    expect(rects.guardrails.w).toBe(12);
    expect(rects.guardrails.y).toBeGreaterThan(rects.domains.y);
  });

  it("never lets a panel be narrower than the minimum or wider than the grid", () => {
    const rects = defaultRects([
      { id: "tiny", type: "health", span: 0 },
      { id: "huge", type: "health", span: 99 },
    ]);
    expect(rects.tiny.w).toBe(MIN_W);
    expect(rects.huge.w).toBe(GRID_COLS);
  });
});

describe("sanitiseRects", () => {
  it("clamps hand-edited values into something drawable", () => {
    const rects = sanitiseRects(
      { kpis: { x: -5, y: 9, w: 99, h: 999 }, usage: { x: 0, y: 4, w: 0, h: 0 } },
      PANELS,
    );
    expect(rects.kpis.x).toBe(0);
    expect(rects.kpis.w).toBe(GRID_COLS);
    expect(rects.kpis.h).toBe(MAX_H);
    expect(rects.usage.w).toBe(MIN_W);
    expect(rects.usage.h).toBe(MIN_H);
  });

  it("fills in a panel the saved layout does not mention", () => {
    const rects = sanitiseRects({ kpis: { x: 0, y: 0, w: 12, h: 4 } }, PANELS);
    expect(Object.keys(rects).sort()).toEqual(PANELS.map((p) => p.id).sort());
    expect(rects.health.w).toBeGreaterThan(0);
  });

  it("drops panels that no longer exist", () => {
    const rects = sanitiseRects({ removed: { x: 0, y: 0, w: 6, h: 6 } }, PANELS);
    expect(rects).not.toHaveProperty("removed");
  });

  it("survives junk instead of throwing", () => {
    expect(() => sanitiseRects("nope", PANELS)).not.toThrow();
    expect(() => sanitiseRects(null, PANELS)).not.toThrow();
    expect(Object.keys(sanitiseRects(null, PANELS))).toHaveLength(PANELS.length);
  });
});

describe("compactRects", () => {
  it("pulls panels up to close the hole a removed panel leaves behind", () => {
    const sparse: PanelRects = {
      a: { x: 0, y: 20, w: 6, h: 4 },
      b: { x: 6, y: 20, w: 6, h: 4 },
    };
    const compacted = compactRects(sparse);
    expect(compacted.a.y).toBe(0);
    expect(compacted.b.y).toBe(0);
  });

  it("never places two panels on top of each other", () => {
    const stacked: PanelRects = {
      a: { x: 0, y: 0, w: 12, h: 4 },
      b: { x: 0, y: 0, w: 12, h: 4 },
    };
    const compacted = compactRects(stacked);
    expect(compacted.b.y).toBe(4);
  });
});

describe("pushDownRects", () => {
  const base: PanelRects = {
    a: { x: 0, y: 0, w: 6, h: 4 },
    b: { x: 6, y: 0, w: 6, h: 4 },
    c: { x: 0, y: 8, w: 12, h: 4 },
  };

  it("keeps the gap the user left — nothing floats upward", () => {
    const moved: PanelRects = { ...base, a: { x: 0, y: 12, w: 6, h: 4 } };
    const out = pushDownRects(moved, "a");
    expect(out.a.y).toBe(12);
    expect(out.b.y).toBe(0);
  });

  it("does not move a panel the drop did not land on", () => {
    const moved: PanelRects = { ...base, a: { x: 0, y: 20, w: 6, h: 4 } };
    const out = pushDownRects(moved, "a");
    expect(out.c.y).toBe(8);
    expect(out.b.y).toBe(0);
  });

  it("pushes a panel the drop actually covers, just far enough to clear it", () => {
    const moved: PanelRects = { ...base, a: { x: 0, y: 8, w: 12, h: 4 } };
    const out = pushDownRects(moved, "a");
    expect(out.a.y).toBe(8);
    expect(out.c.y).toBe(12);
    expect(out.b.y).toBe(0);
  });

  it("leaves a legal layout completely untouched", () => {
    expect(pushDownRects(base, "c")).toEqual(base);
  });
});

describe("sanitiseRects keeps an arranged board as arranged", () => {
  it("does not compact a stored gap away on load", () => {
    const stored = defaultRects(PANELS);
    const last = PANELS[PANELS.length - 1].id;
    stored[last] = { ...stored[last], y: stored[last].y + 6 };
    const out = sanitiseRects(stored, PANELS);
    expect(out[last].y).toBe(stored[last].y);
    expect(pushDownRects(out)).toEqual(out);
  });
});

describe("layoutItems", () => {
  it("hands the grid component one item per panel, with the minimums attached", () => {
    const items = layoutItems(PANELS, defaultRects(PANELS));
    expect(items).toHaveLength(PANELS.length);
    expect(items[0]).toMatchObject({ i: "kpis", minW: MIN_W, minH: MIN_H, maxH: MAX_H });
    expect(items.every((item) => item.w >= MIN_W && item.h >= MIN_H)).toBe(true);
  });
});

describe("spanPercent", () => {
  it("maps columns to the CSS width the static layout would use", () => {
    expect(spanPercent(6)).toBe("50%");
    expect(spanPercent(12)).toBe("100%");
    expect(spanPercent(99)).toBe("100%");
  });
});
