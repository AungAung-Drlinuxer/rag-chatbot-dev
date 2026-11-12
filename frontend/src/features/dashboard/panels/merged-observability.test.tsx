/**
 * The merged board: usage panels inside Overview.
 *
 * What this guards:
 *   - a non-administrator must never call the usage endpoint (it is refused server-side) and
 *     must never see a cost figure,
 *   - an administrator sees real tokens/cost/latency, not placeholders,
 *   - the default layouts differ by role, so the board still fits both jobs,
 *   - a refusal reads as a refusal, not as "we spent $0".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/dashboard/api", () => ({
  dashStats: vi.fn(),
  dashConversations: vi.fn(),
  dashDomains: vi.fn(),
  dashRecentConversations: vi.fn(),
  dashRecentTickets: vi.fn(),
  dashHealth: vi.fn(),
  dashGateTrend: vi.fn(),
  getBoardLayout: vi.fn(async () => ({ board: null, custom: false, updated_at: null })),
  saveBoardLayout: vi.fn(async () => ({ board: null, custom: true, updated_at: null })),
  clearBoardLayout: vi.fn(async () => ({ board: null, custom: false, updated_at: null })),
}));

vi.mock("@/features/observability/api", () => ({
  getObservabilityOverview: vi.fn(),
  getGuardrailEvents: vi.fn(),
  getServiceHealth: vi.fn(),
}));

import * as api from "@/features/dashboard/api";
import * as obsApi from "@/features/observability/api";
import Dashboard from "@/features/dashboard/pages/DashboardPage";
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_ADMIN } from "@/features/dashboard/panels/types";

const m = api as unknown as Record<string, any>;
const o = obsApi as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function overview() {
  return {
    range: { start: "2026-11-01T00:00:00Z", end: "2026-11-08T00:00:00Z", label: "Last 7 days" },
    totals: {
      requests: 128, tokens_in: 154321, tokens_out: 42310, cost_usd: 0.4213,
      avg_latency_ms: 2100, p50_latency_ms: 1800, p95_latency_ms: 5400, max_latency_ms: 12000,
    },
    series: [
      { day: "2026-11-06", requests: 60, tokens_in: 80000, tokens_out: 20000, cost: 0.2, p95_ms: 5000 },
      { day: "2026-11-07", requests: 68, tokens_in: 74321, tokens_out: 22310, cost: 0.2213, p95_ms: 5400 },
    ],
    by_model: [{ model: "openai/gpt-4o-mini", requests: 128, tokens_in: 154321, tokens_out: 42310, cost: 0.4213 }],
    decisions: [{ decision: "answer", n: 100 }, { decision: "caution", n: 28 }],
    domains: [{ domain: "network", n: 44 }],
    guardrails: [{ action: "guardrail.injection", n: 7 }],
    guardrail_total: 7,
    counts: { kb_articles: 94, tickets_open: 4, users: 5, sessions: 31 },
    generated_at: "2026-11-08T05:30:00Z",
  };
}

function happyPath() {
  m.dashStats.mockResolvedValue({ total_conversations: 4, resolved_by_bot: 3, escalated_to_tickets: 1, active_users: 2, kb_pages: 9, attacks_blocked_7d: 1, deltas: {}, previous: {} });
  m.dashConversations.mockResolvedValue({ series: [] });
  m.dashDomains.mockResolvedValue({ domains: [] });
  m.dashRecentConversations.mockResolvedValue({ conversations: [] });
  m.dashRecentTickets.mockResolvedValue({ tickets: [] });
  m.dashHealth.mockResolvedValue({ services: [], overall: "Healthy", down: [], security: {} });
  m.dashGateTrend.mockResolvedValue({ series: [] });
  o.getObservabilityOverview.mockResolvedValue(overview());
  o.getGuardrailEvents.mockResolvedValue({
    events: [
      { action: "guardrail.injection", username: "alice", domain: null, decision: null, detail: "ignore previous instructions", created_at: "2026-11-08T05:00:00Z" },
    ],
  });
}

async function mount(props: { role?: string; perms?: Record<string, boolean> }) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Dashboard role={props.role} perms={props.perms} />); });
  await settle();
  await settle();
  return container;
}

beforeEach(() => { vi.clearAllMocks(); happyPath(); });

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("merged Overview + Observability", () => {
  it("keeps usage panels in the admin default and out of the user default", () => {
    const adminTypes = DEFAULT_LAYOUT_ADMIN.map((p) => p.type);
    const userTypes = DEFAULT_LAYOUT.map((p) => p.type);
    expect(adminTypes).toContain("usage-kpis");
    expect(adminTypes).toContain("guardrail-events");
    expect(userTypes).not.toContain("usage-kpis");
    expect(userTypes).not.toContain("guardrail-events");
    // Both boards still open with the thing an operator acts on first.
    // The board leads with the numbers; there is no "attention" strip any more.
    expect(adminTypes[0]).toBe("kpis");
    expect(userTypes[0]).toBe("kpis");
  });

  it("renders real tokens, cost and p95 latency for an administrator", async () => {
    const text = (await mount({ role: "admin" })).textContent!;
    // In/out are stacked in their own tile so a narrow card never clips the second number.
    expect(text).toContain("In 154,321");
    expect(text).toContain("Out 42,310");
    expect(text).toContain("$0.4213");
    expect(text).toContain("5.4s");
    expect(text).toContain("Tokens & cost by model");
    expect(text).toContain("openai/gpt-4o-mini");
  });

  it("lists guardrail events with the user and the refusal reason", async () => {
    const text = (await mount({ role: "admin" })).textContent!;
    expect(text).toContain("7 events");
    expect(text).toContain("alice");
    expect(text).toContain("ignore previous instructions");
  });

  it("does not call the usage endpoint for a plain user, and shows no cost", async () => {
    const text = (await mount({ role: "user" })).textContent!;
    expect(o.getObservabilityOverview).not.toHaveBeenCalled();
    expect(text).not.toContain("Estimated cost");
    expect(text).not.toContain("Tokens in / out");
  });

  it("treats a manage_users capability as sufficient even without the admin role", async () => {
    await mount({ role: "user", perms: { manage_users: true } });
    expect(o.getObservabilityOverview).toHaveBeenCalledTimes(1);
  });

  it("says permission is required rather than showing a zero spend on a 403", async () => {
    o.getObservabilityOverview.mockRejectedValue(new Error("overview failed: HTTP 403"));
    const text = (await mount({ role: "admin" })).textContent!;
    expect(text).toContain("Administrator permission required to see token and cost data.");
    expect(text).not.toContain("$0.00 total");
  });

  it("surfaces a non-403 failure as an error, not as a permission problem", async () => {
    o.getObservabilityOverview.mockRejectedValue(new Error("overview failed: HTTP 500"));
    const text = (await mount({ role: "admin" })).textContent!;
    expect(text).toContain("overview failed: HTTP 500");
    expect(text).not.toContain("Administrator permission required to see spend.");
  });
});
