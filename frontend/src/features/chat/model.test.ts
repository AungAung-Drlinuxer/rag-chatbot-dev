import { describe, expect, it } from "vitest";

import { formatMessageTime } from "./model";

/** A message's bubble must show when it was SAID. The old code rendered the moment the
 *  page was opened, so every re-opened conversation read as "now". */
describe("formatMessageTime", () => {
  it("shows only the clock for a message sent today", () => {
    const today = new Date();
    today.setHours(9, 41, 0, 0);
    expect(formatMessageTime(today.toISOString())).toBe("09:41");
  });

  it("adds the day for an older message in the same year", () => {
    const source = new Date(2026, 7, 8, 22, 10); // 08 Aug 2026, local
    const now = new Date(2026, 10, 9, 12, 0);
    const fixed = new Date(source);
    const out = formatMessageTime(fixed.toISOString());
    expect(out).toMatch(/Aug 08/);
    expect(out).toMatch(/22:10/);
    expect(now.getFullYear()).toBe(2026);
  });

  it("adds the year when the message is older than this year", () => {
    const old = new Date(2024, 0, 3, 7, 5);
    const out = formatMessageTime(old.toISOString());
    expect(out).toMatch(/2024/);
  });

  it("falls back to the clock when the backend sent nothing", () => {
    expect(formatMessageTime(null)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatMessageTime(undefined)).toMatch(/\d{1,2}:\d{2}/);
    expect(formatMessageTime("not-a-date")).toMatch(/\d{1,2}:\d{2}/);
  });
});
