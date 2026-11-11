/**
 * Auto-fit is a rule about screens, so it is tested as a rule.
 *
 * The cases are the ones a desk actually has: a 1366 laptop, a 1080p 24" (1920 CSS px), a
 * 1440p 27", a 4K screen at 2x (1920 CSS px but dense), and a phone-sized window. A 21.5" and
 * a 24" at 1080p are the same input on purpose — no browser distinguishes them.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  applyFitScale,
  autoFitEnabled,
  FIT_STORAGE_KEY,
  fitScale,
  setAutoFit,
} from "@/app/displayFit";

describe("fitScale", () => {
  it("is exactly 1 at the width the design was drawn at", () => {
    expect(fitScale({ screenWidth: 1440, innerWidth: 1440, dpr: 1 })).toBe(1);
  });

  it("grows a little on a 1080p 24-inch screen", () => {
    expect(fitScale({ screenWidth: 1920, innerWidth: 1920, dpr: 1 })).toBe(1.1);
  });

  it("does not inflate a 4K screen that is already dense", () => {
    // 3840 physical px at dpr 2 = 1920 CSS px, the same as the 1080p case, but the pixels are
    // finer — scaling it up as well would look oversized.
    expect(fitScale({ screenWidth: 1920, innerWidth: 1920, dpr: 2 })).toBe(1);
  });

  it("treats a 1366 laptop as the design width, and floors small windows at 0.9", () => {
    // 2% smaller than the design is not worth a different rendering: it snaps to 1.
    expect(fitScale({ screenWidth: 1366, innerWidth: 1366, dpr: 1 })).toBe(1);
    expect(fitScale({ screenWidth: 1024, innerWidth: 1024, dpr: 1 })).toBe(0.9);
  });

  it("never exceeds 1.2, even on a very wide display", () => {
    expect(fitScale({ screenWidth: 5120, innerWidth: 5120, dpr: 1 })).toBe(1.2);
  });

  it("uses a window wider than the reported screen", () => {
    // A stale `screen` report must not shrink the interface on a maximised window.
    expect(fitScale({ screenWidth: 800, innerWidth: 1920, dpr: 1 })).toBe(1.1);
  });
});

describe("the auto-fit preference", () => {
  afterEach(() => {
    localStorage.removeItem(FIT_STORAGE_KEY);
    document.documentElement.style.removeProperty("--ui-scale");
  });

  it("defaults to on", () => {
    expect(autoFitEnabled()).toBe(true);
  });

  it("remembers being switched off", () => {
    setAutoFit(false);
    expect(autoFitEnabled()).toBe(false);
    setAutoFit(true);
    expect(autoFitEnabled()).toBe(true);
  });

  it("writes the scale the css reads, and clears it at 1", () => {
    applyFitScale(1.1);
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.1");
    applyFitScale(1);
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("");
  });
});
