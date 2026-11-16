import { describe, expect, it } from "vitest";

import { formatMessageTime, withStreamUsage, type Message } from "./model";

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

/* The usage pill belongs to the answer that just arrived. Before this, `done` carried the
   numbers and the UI dropped them, so a fresh answer looked tokenless until the conversation
   was reloaded from the server. */
describe("withStreamUsage", () => {
  const message: Message = {
    id: "m-1",
    role: "assistant",
    content: "Reconnect the VPN profile.",
    timestamp: "2026-11-16T10:00:00Z",
  };

  it("copies input/output tokens from the done payload onto the message", () => {
    const next = withStreamUsage(message, { usage: { input_tokens: 6831, output_tokens: 987 } });
    expect(next.usage?.input_tokens).toBe(6831);
    expect(next.usage?.output_tokens).toBe(987);
  });

  it("keeps a total when the backend sends one", () => {
    const next = withStreamUsage(message, {
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    expect(next.usage?.total_tokens).toBe(15);
  });

  it("leaves the message untouched when the event has no usage", () => {
    expect(withStreamUsage(message, { message_id: "m-1" })).toBe(message);
    expect(withStreamUsage(message, null)).toBe(message);
  });

  it("does not erase tokens a previous event already set", () => {
    const withTokens: Message = { ...message, usage: { input_tokens: 5, output_tokens: 2 } };
    const next = withStreamUsage(withTokens, { usage: { output_tokens: 9 } });
    expect(next.usage).toEqual({ input_tokens: 5, output_tokens: 9, total_tokens: undefined });
  });
});
