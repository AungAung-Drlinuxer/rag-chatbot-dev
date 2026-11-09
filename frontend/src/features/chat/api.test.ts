/**
 * A throttled chat request must say what happened and how long to wait — the previous
 * behaviour surfaced "The answer could not be generated: HTTP 429", which reads like a bug.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChat } from "@/features/chat/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function stubFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
}

describe("streamChat — rate limiting", () => {
  it("turns a 429 into an actionable message", async () => {
    stubFetch(new Response(JSON.stringify({ detail: "Rate limit exceeded" }), {
      status: 429,
      headers: { "Retry-After": "37", "Content-Type": "application/json" },
    }));

    await expect(streamChat("hi", "s-1", [], () => {})).rejects.toThrow(
      "Too many requests — please wait 37s and try again.",
    );
  });

  it("falls back to 5 seconds when Retry-After is missing", async () => {
    stubFetch(new Response("", { status: 429 }));
    await expect(streamChat("hi", "s-1", [], () => {})).rejects.toThrow(/wait 5s/);
  });

  it("still reports an expired session as such", async () => {
    stubFetch(new Response("", { status: 401 }));
    await expect(streamChat("hi", "s-1", [], () => {})).rejects.toThrow(/Session expired/);
  });
});
