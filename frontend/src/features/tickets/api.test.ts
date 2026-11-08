/**
 * Ticket API client — a refused status change must reject.
 *
 * The page used to read the response body without checking `ok`, so a 409 from the backend
 * (Jira declined the transition) looked exactly like success: the optimistic status stayed on
 * screen and "Saved in the queue — Jira did not accept" was the closest thing to a warning.
 * The board then disagreed with Jira until the next pull reverted it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The mock stands in for apiFetch, so this test never touches the network: it asserts how the
// client interprets a response, which is the part that regressed.
vi.mock("@/shared/api/client", () => ({
  BASE: "",
  authHeaders: () => ({}),
  apiFetch: vi.fn(),
}));

import * as client from "@/shared/api/client";
import { ticketUpdate } from "@/features/tickets/api";

const apiFetch = (client as unknown as { apiFetch: ReturnType<typeof vi.fn> }).apiFetch;

beforeEach(() => { apiFetch.mockReset(); });

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("ticketUpdate", () => {
  it("rejects with the backend's reason when Jira refuses the transition", async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse(409, {
      detail: "Jira refused the status change: no matching transition for 'closed' (available: ['reopen issue'])",
    }));

    await expect(ticketUpdate("ITHD-36", { status: "closed" })).rejects.toThrow(/Jira refused/);
  });

  it("resolves with the body on success", async () => {
    apiFetch.mockResolvedValueOnce(jsonResponse(200, { ok: true, changes: ["status → closed"], jira_synced: true }));
    const res = await ticketUpdate("ITHD-36", { status: "closed" });
    expect(res.jira_synced).toBe(true);
  });

  it("still rejects with the HTTP status when the body is not JSON", async () => {
    apiFetch.mockResolvedValueOnce(new Response("bad gateway", { status: 502 }));
    await expect(ticketUpdate("ITHD-36", { status: "closed" })).rejects.toThrow(/502/);
  });
});
