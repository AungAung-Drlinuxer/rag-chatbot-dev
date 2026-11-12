import { describe, expect, it } from "vitest";
import {
  ADMIN_BANDS,
  MIN_SPAN,
  USER_BANDS,
  MIN_BAND_PX,
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
  it("south drag raises this band's floor out of the one below", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 2, "s", 40);
    expect(next[1].px).toBe(182 + 40);
    expect(next[2].px).toBe(168 - 40);
    // a band's height is a floor now, so no total has to be conserved vertically
    expect(next[1].min).toBeLessThanOrEqual(next[1].px!);
  });

  it("north drag takes from the band above, including the content-sized strip", () => {
    const bands = USER_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 2, "n", 40);
    expect(next[0].px).toBe(112 - 40);
    expect(next[1].px).toBe(210 + 40);
    expect(next[0].auto).toBe(false);
  });

  it("pulling an edge upward shrinks this band and grows the one below", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 3, "s", -50);
    expect(next[2].px).toBe(168 - 50);
    expect(next[3].px).toBe(200 + 50);
  });

  it("grows the last band, taking the room from the bands above", () => {
    // The bottom panel has no neighbour below it; its south edge used to be dead, which is
    // why guardrail events could never be extended downward.
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    const next = resizeBand(bands, 4, "s", 60);

    expect(next[3].px).toBe(200 + 60);
    // every band above donates in proportion to the room it has left above the floor
    const taken = [0, 1, 2].reduce((sum, i) => sum + (bands[i].min - next[i].px!), 0);
    expect(taken).toBeCloseTo(60, 5);
    expect(next[1].px!).toBeLessThan(bands[1].min);
  });

  it("never shrinks a band below the floor, and ignores a zero drag", () => {
    const bands = ADMIN_BANDS.map((b) => ({ ...b }));
    expect(resizeBand(bands, 2, "s", 0)).toEqual(bands);
    const collapsed = resizeBand(bands, 2, "s", -10_000);
    // band 2 can only shrink to MIN_BAND_PX; the rest of the drag is dropped
    expect(collapsed[1].px).toBe(MIN_BAND_PX);
    expect(collapsed[2].px).toBe(168 + (182 - MIN_BAND_PX));
  });
});

describe("boardRows", () => {
  it("writes the template the page hands to CSS", () => {
    expect(boardRows(ADMIN_BANDS)).toBe(
      "minmax(112px,auto) minmax(182px,auto) minmax(168px,auto) minmax(200px,auto)",
    );
  });
});
