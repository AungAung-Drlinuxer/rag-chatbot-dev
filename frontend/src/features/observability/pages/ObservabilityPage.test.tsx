/**
 * Observability page — the in-app Grafana replacement.
 *
 * The failure this guards is a dashboard that looks authoritative while it lies: a page that
 * draws zeroes when the endpoint failed, or invents a chart from an empty table. Every test
 * here is about the page saying what it actually knows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/observability/api", () => ({
  getObservabilityOverview: vi.fn(),
  getGuardrailEvents: vi.fn(),
  getServiceHealth: vi.fn(),
}));

import * as api from "@/features/observability/api";
import ObservabilityPage from "./ObservabilityPage";

const m = api as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function overview(overrides: Record<string, unknown> = {}) {
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
    decisions: [{ decision: "answer", n: 100 }, { decision: "caution", n: 20 }, { decision: "escalate", n: 8 }],
    domains: [{ domain: "network", n: 44 }, { domain: "database", n: 30 }],
    guardrails: [{ action: "guardrail.injection", n: 7 }, { action: "guardrail.toxic", n: 3 }],
    guardrail_total: 10,
    counts: { kb_articles: 94, tickets_open: 4, users: 5, sessions: 31 },
    generated_at: "2026-11-08T05:30:00Z",
    ...overrides,
  };
}

function happyPath() {
  m.getObservabilityOverview.mockResolvedValue(overview());
  m.getServiceHealth.mockResolvedValue({
    overall: "Healthy",
    down: [],
    services: [
      { key: "postgres", name: "PostgreSQL + pgvector", status: "Healthy", latency_ms: 3, detail: null },
      { key: "redis", name: "Redis", status: "Healthy", latency_ms: 1, detail: null },
    ],
    security: { guardrail_events_7d: 10 },
  });
  m.getGuardrailEvents.mockResolvedValue({
    events: [
      { action: "guardrail.injection", username: "alice", domain: null, decision: null, detail: "ignore previous instructions", created_at: "2026-11-08T05:00:00Z" },
    ],
  });
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<ObservabilityPage role="admin" />); });
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

describe("Observability page", () => {
  it("renders the token, cost and latency figures from the API", async () => {
    const text = (await mount()).textContent!;
    expect(text).toContain("Answers");
    expect(text).toContain("128");
    expect(text).toContain("154,321 / 42,310");
    expect(text).toContain("$0.4213");
    expect(text).toContain("5.4s");
    expect(text).toContain("p50 1.8s");
  });

  it("shows the decision split, guardrails and service health", async () => {
    const text = (await mount()).textContent!;
    expect(text).toContain("answer");
    expect(text).toContain("caution");
    expect(text).toContain("escalate");
    expect(text).toContain("events blocked in this window");
    expect(text).toContain("PostgreSQL + pgvector");
    expect(text).toContain("Redis");
    expect(text).toContain("Healthy");
  });

  it("lists recent guardrail events with the user who triggered them", async () => {
    const text = (await mount()).textContent!;
    expect(text).toContain("alice");
    expect(text).toContain("injection");
    expect(text).toContain("ignore previous instructions");
  });

  it("says 'no data' instead of drawing zeroes when the window is empty", async () => {
    m.getObservabilityOverview.mockResolvedValue(overview({
      totals: { requests: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, avg_latency_ms: 0, p50_latency_ms: 0, p95_latency_ms: 0, max_latency_ms: 0 },
      series: [], decisions: [], by_model: [], domains: [], guardrails: [], guardrail_total: 0,
    }));
    const text = (await mount()).textContent!;
    expect(text).toContain("No data in this window.");
    expect(text).toContain("No answers in this window.");
    expect(text).toContain("No usage recorded yet.");
  });

  it("surfaces a failure as a banner and not as a quiet zero", async () => {
    m.getObservabilityOverview.mockRejectedValue(new Error("overview failed: HTTP 500"));
    const text = (await mount()).textContent!;
    expect(text).toContain("Metrics unavailable.");
    expect(text).toContain("HTTP 500");
  });

  it("explains that the event list needs admin rather than showing an empty table", async () => {
    m.getGuardrailEvents.mockRejectedValue(new Error("events failed: HTTP 403"));
    const text = (await mount()).textContent!;
    expect(text).toContain("Administrator permission required to list events.");
    expect(text).toContain("Ask an administrator for access.");
  });

  it("names the dependencies that are failing", async () => {
    m.getServiceHealth.mockResolvedValue({
      overall: "Degraded",
      down: ["Redis"],
      services: [{ key: "redis", name: "Redis", status: "Down", latency_ms: null, detail: "ConnectionError" }],
      security: {},
    });
    const text = (await mount()).textContent!;
    expect(text).toContain("Failing: Redis");
    expect(text).toContain("Degraded");
  });
});
