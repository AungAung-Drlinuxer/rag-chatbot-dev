import { describe, expect, it } from "vitest";
import {
  ADMIN_BANDS,
  MIN_SPAN,
  USER_BANDS,
  boardRows,
  packBands,
  resizeBand,
  resizeSpan,
} from "./boardLayout";

const adminPanels = [
  { id: "kpis", span: 12, row: 1 },
  { id: "usage", span: 6, row: 2 },
  { id: "trend", span: 6, row: 2 },
  { id: "domains", span: 3, row: 3 },
  { id: "tokens", span: 3, row: 3 },
  { id: "health", span: 3, row: 3 },
  { id: "knowledge", span: 3, row: 3 },
  { id: "guardrails", span: 12, row: 4 },
];

describe("packBands", () => {
  it("places each band left to right, filling all 12 columns", () => {
    const boxes = packBands(adminPanels);
    const byId = Object.fromEntries(boxes.map((b) => [b.id, b]));
    expect(byId.usage).toMatchObject({ start: 1, span: 6, row: 2 });
    expect(byId.trend).toMatchObject({ start: 7, span: 6, row: 2 });
    expect(byId.domains.start).toBe(1);
    expect(byId.tokens.start).toBe(4);
    expect(byId.health.start).toBe(7);
    expect(byId.knowledge.start).toBe(10);

    for (const row of [2, 3, 4]) {
      const total = boxes.filter((b) => b.row === row).reduce((sum, b) => sum + b.span, 0);
      expect(total).toBe(12);
    }
  });

  it("keeps a minimum span and never lets a panel run past column 12", () => {
    const boxes = packBands([
      { id: "a", span: 1, row: 1 },
      { id: "b", span: 20, row: 2 },
    ]);
    expect(boxes[0].span).toBe(MIN_SPAN);
    expect(boxes[1].span).toBe(12);
    expect(boxes[1].start).toBe(1);
  });
});

describe("resizeSpan", () => {
  it("east drag takes columns from the panel on the right", () => {
    const boxes = packBands(adminPanels);
    const next = resizeSpan(boxes, "usage", "e", 2);
    const byId = Object.fromEntries(next.map((b) => [b.id, b]));
    expect(byId.usage.span).toBe(8);
    expect(byId.trend.span).toBe(4);
    expect(byId.trend.start).toBe(9);
    // the band is still exactly full
    expect(byId.usage.span + byId.trend.span).toBe(12);
  });

  it("west drag takes columns from the panel on the left", () => {
    const boxes = packBands(adminPanels);
    const next = resizeSpan(boxes, "trend", "w", 2);
    const byId = Object.fromEntries(next.map((b) => [b.id, b]));
    expect(byId.trend.span).toBe(8);
    expect(byId.trend.start).toBe(5);
    expect(byId.usage.span).toBe(4);
  });

  it("stops when the neighbour reaches its minimum instead of overlapping it", () => {
    const boxes = packBands(adminPanels);
    const next = resizeSpan(boxes, "usage", "e", 10);
    const byId = Object.fromEntries(next.map((b) => [b.id, b]));
    expect(byId.trend.span).toBe(MIN_SPAN);
    expect(byId.usage.span).toBe(10);
    expect(byId.usage.span + byId.trend.span).toBe(12);
  });

  it("does nothing at the edge of a band or for an unknown panel", () => {
    const boxes = packBands(adminPanels);
    expect(resizeSpan(boxes, "trend", "e", 3)).toBe(boxes);
    expect(resizeSpan(boxes, "nope", "e", 3)).toBe(boxes);
    expect(resizeSpan(boxes, "usage", "e", 0)).toBe(boxes);
  });
});

describe("resizeBand", () => {
  it("south drag grows this band out of the one below", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 2, "s", 0.2);
    expect(next[1].fr).toBeCloseTo(1.16, 5);
    expect(next[2].fr).toBeCloseTo(0.64, 5);
    const total = next.reduce((sum, b) => sum + b.fr, 0);
    expect(total).toBeCloseTo(0.96 + 0.84 + 1.18, 5);
  });

  it("north drag takes from the band above", () => {
    const bands = USER_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 2, "n", 0.3);
    expect(next[0].auto).toBe(true);
    // the content-sized band has no share to trade
    expect(next[1].fr).toBe(1.2);
  });

  it("pulling an edge upward shrinks the band and grows the one below", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 3, "s", -0.15);
    expect(next[2].fr).toBeCloseTo(0.69, 5);
    expect(next[3].fr).toBeCloseTo(1.33, 5);
  });

  it("grows the last band, taking the space from the bands above", () => {
    // The bottom panel has no neighbour below it; its south edge used to be dead, which is
    // why guardrail events could never be extended downward.
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 4, "s", 0.4);

    expect(next[3].fr).toBeCloseTo(1.58, 5);
    const given = (bands[1].fr - next[1].fr) + (bands[2].fr - next[2].fr);
    expect(given).toBeCloseTo(0.4, 3);
    expect(next[0]).toEqual(bands[0]); // the content-sized strip never trades height
  });

  it("refuses to shrink a band below its floor, and leaves the auto band alone", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    expect(resizeBand(bands, 1, "s", 1)).toEqual(bands);
    const floored = resizeBand(bands, 2, "s", 5);
    // the panel below can only give up what it has above the floor
    expect(floored[1].fr).toBeCloseTo(1.55, 5);
    expect(floored[2].fr).toBeCloseTo(0.25, 5);
  });
});

describe("boardRows", () => {
  it("writes the template the page hands to CSS", () => {
    expect(boardRows(ADMIN_BANDS)).toBe(
      "minmax(112px,auto) minmax(182px,0.96fr) minmax(168px,0.84fr) minmax(200px,1.18fr)",
    );
  });
});
