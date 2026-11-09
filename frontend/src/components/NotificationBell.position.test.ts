/**
 * The bell panel is positioned from the trigger's rect (fixed + portal), so the geometry
 * is testable on its own. Regression: the panel used to hang off the right edge of a phone
 * screen and was clipped.
 */
import { describe, expect, it } from "vitest";

import { computePanelPosition } from "@/components/NotificationBell";

const MARGIN = 8;

describe("computePanelPosition", () => {
  it("pulls the panel back inside when the bell sits at the right edge", () => {
    const box = computePanelPosition({ left: 340, width: 36, bottom: 60 }, 390, 844);
    expect(box.left + box.width).toBeLessThanOrEqual(390 - MARGIN);
    expect(box.left).toBeGreaterThanOrEqual(MARGIN);
  });

  it("keeps the panel inside when the bell sits at the left edge", () => {
    const box = computePanelPosition({ left: 0, width: 36, bottom: 60 }, 390, 844);
    expect(box.left).toBe(MARGIN);
  });

  it("centres under the bell when there is room", () => {
    const box = computePanelPosition({ left: 500, width: 36, bottom: 60 }, 1280, 800);
    const centreOfPanel = box.left + box.width / 2;
    const centreOfBell = 500 + 18;
    expect(Math.abs(centreOfPanel - centreOfBell)).toBeLessThanOrEqual(1);
  });

  it("shrinks the width on a narrow viewport instead of overflowing", () => {
    const box = computePanelPosition({ left: 280, width: 32, bottom: 56 }, 320, 640);
    expect(box.width).toBe(320 - MARGIN * 2);
    expect(box.left).toBe(MARGIN);
  });

  it("opens below the bell and never below the viewport", () => {
    const top = computePanelPosition({ left: 100, width: 36, bottom: 60 }, 800, 900);
    expect(top.top).toBe(66);
    expect(top.maxHeight).toBeGreaterThan(200);

    const bottomEdge = computePanelPosition({ left: 100, width: 36, bottom: 880 }, 800, 900);
    expect(bottomEdge.top).toBeLessThan(880);
    expect(bottomEdge.maxHeight).toBeGreaterThanOrEqual(200);
    expect(bottomEdge.top + bottomEdge.maxHeight).toBeLessThanOrEqual(900);
  });
});
