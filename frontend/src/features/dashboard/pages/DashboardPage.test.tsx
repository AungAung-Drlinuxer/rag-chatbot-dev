/**
 * DashboardPage — the overview every role lands on.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component; every
 * decision worth guarding (empty vs zeroes, the failure banner, the honest delta wording,
 * which window the footer names) is a render-time branch driven by SEVEN parallel
 * endpoints. So the test mounts the real component against mocked feature APIs and reads
 * the DOM.
 *
 * The failure this guards: this page used to keep sample fallbacks on failure, so a dead
 * backend rendered a quiet-looking day of plausible numbers. There are no fallbacks now —
 * a failure must surface as a banner and "—" KPI values, never as zeroes.
 *
 * Harness note: the repo has no @testing-library by choice, so this uses react-dom/client
 * inside act() and queries the DOM directly (same spirit as MarkdownMessage.test.tsx,
 * which uses renderToStaticMarkup).
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
import Dashboard from "./DashboardPage";

const m = api as unknown as Record<string, any>;
const o = obsApi as unknown as Record<string, any>;

/** A full, healthy backend — the baseline every test starts from. */
function happyPath() {
  o.getObservabilityOverview.mockResolvedValue({
    range: { start: "2026-01-01T00:00:00Z", end: "2026-01-08T00:00:00Z", label: "Last 7 days" },
    totals: {
      requests: 12, tokens_in: 4800, tokens_out: 1200, cost_usd: 0.0123,
      avg_latency_ms: 2400, p50_latency_ms: 1900, p95_latency_ms: 6100, max_latency_ms: 9000,
    },
    series: [{ day: "2026-01-06", requests: 12, tokens_in: 4800, tokens_out: 1200, cost: 0.0123, p95_ms: 6100 }],
    by_model: [{ model: "openai/gpt-4o-mini", requests: 12, tokens_in: 4800, tokens_out: 1200, cost: 0.0123 }],
    decisions: [{ decision: "answer", n: 10 }, { decision: "caution", n: 2 }],
    domains: [{ domain: "network", n: 7 }],
    guardrails: [{ action: "guardrail.injection", n: 2 }],
    guardrail_total: 2,
    counts: { kb_articles: 120, tickets_open: 1, users: 1, sessions: 12 },
    generated_at: "2026-01-08T02:00:00Z",
  });
  o.getGuardrailEvents.mockResolvedValue({
    events: [{ action: "guardrail.injection", username: "alice", domain: null, decision: null, detail: "ignore previous", created_at: "2026-01-07T10:00:00Z" }],
  });
  m.dashStats.mockResolvedValue({
    total_conversations: 42,
    resolved_by_bot: 30,
    escalated_to_tickets: 5,
    active_users: 7,
    kb_pages: 120,
    attacks_blocked_7d: 3,
    deltas: { total_conversations: 12, resolved_by_bot: 8, active_users: -3 },
    previous: { total_conversations: 30, resolved_by_bot: 22, active_users: 10 },
  });
  m.dashConversations.mockResolvedValue({
    series: [{ day: "Mon", total: 5, resolved: 4, escalated: 1 }],
    start: "2026-01-01",
    end: "2026-01-07",
  });
  m.dashDomains.mockResolvedValue({
    domains: [
      { name: "database", count: 20, percentage: 40 },
      { name: "network", count: 10, percentage: 20 },
    ],
  });
  m.dashRecentConversations.mockResolvedValue({
    conversations: [{ time: "2026-01-02T10:00:00Z", user: "alice", question: "how to restart nginx", result: "Resolved" }],
  });
  m.dashRecentTickets.mockResolvedValue({
    tickets: [{ id: "IT-1", subject: "VPN down", status: "open", priority: "high" }],
  });
  m.dashHealth.mockResolvedValue({
    services: [
      { key: "postgres", name: "PostgreSQL", status: "Healthy", latency_ms: 5 },
      { key: "redis", name: "Redis", status: "Down", detail: "conn refused" },
    ],
    overall: "Degraded",
    down: ["Redis"],
    security: { guardrail_events_7d: 2 },
  });
  m.dashGateTrend.mockResolvedValue({ series: [{ day: "Mon", answered: 5, cautioned: 1 }] });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function mount(role?: string) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Dashboard role={role} />); });
  await settle();
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("DashboardPage — data rendering", () => {
  it("renders the KPI figures straight from /stats, not placeholders", async () => {
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("Total Conversations");
    expect(text).toContain("42");
    expect(text).toContain("Resolved by Bot");
    expect(text).toContain("30");
    expect(text).toContain("Active Users");
    expect(text).toContain("120");
    // Loading is over: the pulse placeholders must be gone.
    expect(el.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });

  it("labels a healthy week-over-week delta with a real percentage", async () => {
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("+12%");
    expect(text).toContain("vs previous 7 days");
  });

  it("labels a tiny baseline instead of printing a 4-digit percentage", async () => {
    m.dashStats.mockResolvedValue({
      total_conversations: 25, resolved_by_bot: 10, escalated_to_tickets: 1,
      active_users: 3, kb_pages: 5,
      deltas: { total_conversations: 400 }, previous: { total_conversations: 5 },
    });
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("up from 5 last week");
    expect(text).not.toContain("+400%");
  });

  it("says 'no escalations this week' rather than a misleading −100%", async () => {
    m.dashStats.mockResolvedValue({
      total_conversations: 10, resolved_by_bot: 10, escalated_to_tickets: 0,
      active_users: 2, kb_pages: 1, deltas: {}, previous: {},
    });
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("no escalations this week");
  });

  it("renders the domain breakdown and the token detail, not the ticket queue", async () => {
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("database");
    expect(text).toContain("40%");
    // Tokens are broken down per model on the board (who spent the window's tokens).
    expect(text).toContain("Tokens & cost by model");
    expect(text).toContain("openai/gpt-4o-mini");
    // The ticket queue and the review queue live on their own pages, by request.
    expect(text).not.toContain("IT-1");
    expect(text).not.toContain("Needs review");
  });

  /**
   * The board is a Grafana-style grid: every panel owns a rectangle, and the arrange mode
   * frees it. Both halves matter — geometry is per panel (not per band), and drag/resize
   * are off until the user asks for them, so reading the board never moves it.
   */
  it("lays the board out as a per-panel grid with an arrange mode", async () => {
    const rootEl = await mount("admin");

    const board = rootEl.querySelector(".react-grid-layout") as HTMLElement;
    expect(board).toBeTruthy();
    expect(board.querySelectorAll("[data-panel]").length).toBeGreaterThan(4);

    const items = [...board.querySelectorAll<HTMLElement>("[data-panel]")];
    const positioned = items.filter((el) => el.style.transform);
    expect(positioned.length).toBe(items.length);

    // Nothing is draggable until Edit layout is pressed.
    expect(board.querySelectorAll("[data-drag-handle]").length).toBe(0);
    expect(rootEl.textContent).toContain("Edit layout");
    expect(rootEl.textContent).toContain("Export CSV");
    expect(rootEl.textContent).toContain("Print");
  });

  it("frees the panels for drag and resize in the arrange mode", async () => {
    const rootEl = await mount("admin");
    const edit = [...rootEl.querySelectorAll("button")].find((b) => b.textContent?.includes("Edit layout"))!;
    await act(async () => { edit.click(); });

    const board = rootEl.querySelector(".react-grid-layout") as HTMLElement;
    expect(board.querySelectorAll("[data-drag-handle]").length).toBeGreaterThan(0);
    expect(rootEl.textContent).toContain("Done editing");
  });

  it("names the failing dependency and the guardrail counter separately", async () => {
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("Failing: Redis");
    expect(text).toContain("PostgreSQL");
    expect(text).toContain("conn refused");
    // Guardrails are a security counter, not a service: they have their own panel (the
    // former Observability board) rather than a footer line under health.
    expect(text).toContain("Guardrail events");
    expect(text).toContain("2 events");
  });

  it("shows the gate-trend empty note when there is no gate data (agent board)", async () => {
    m.dashGateTrend.mockResolvedValue({ series: [] });
    const text = (await mount("user")).textContent!;
    // The gate rate lives in the Answer quality panel; with no gated answers it must say so,
    // never show "NaN%" or a fabricated percentage.
    expect(text).toContain("Confidence gate");
    expect(text).toContain("No gate data yet");
    expect(text).not.toContain("NaN");
  });

  it("hides 'Attacks Blocked' from a non-admin and shows it to an admin", async () => {
    const admin = await mount("admin");
    expect(admin.textContent).toContain("Attacks Blocked (7d)");
    expect(admin.textContent).toContain("Administrator");

    const user = await mount("user");
    expect(user.textContent).not.toContain("Attacks Blocked");
    expect(user.textContent).toContain("User");
  });

  it("names the window the backend ACTUALLY reported in the footer", async () => {
    // With a start/end echo, the footer shows the range — so "Last 7 days" appears only
    // on the picker button.
    const echoed = (await mount("admin")).textContent!;
    // The footer names the echoed range; the usage panels also print the range label, so the
    // assertion is on the footer's rendered dates rather than on a phrase count.
    expect(echoed).toContain("Jan 01, 2026 → Jan 07, 2026");

    // Without the echo the footer falls back to the requested preset.
    m.dashConversations.mockResolvedValue({ series: [{ day: "Mon", total: 5, resolved: 4, escalated: 1 }], start: undefined, end: undefined });
    const fallback = (await mount("admin")).textContent!;
    expect(count(fallback, "Last 7 days")).toBeGreaterThanOrEqual(1);
  });
});

describe("DashboardPage — empty and error states", () => {
  it("shows the 'no activity' empty state (not a grid of zeroes) on a fresh install", async () => {
    m.dashStats.mockResolvedValue(undefined);
    m.dashConversations.mockResolvedValue({ series: [] });
    m.dashDomains.mockResolvedValue({ domains: [] });
    m.dashRecentConversations.mockResolvedValue({ conversations: [] });
    m.dashRecentTickets.mockResolvedValue({ tickets: [] });
    m.dashHealth.mockResolvedValue({ services: [] });
    m.dashGateTrend.mockResolvedValue({ series: [] });

    const el = await mount("admin");
    expect(el.textContent).toContain("No activity in this reporting window");
    const widen = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Widen to 90 days"));
    expect(widen).toBeTruthy();
    await act(async () => { (widen as HTMLButtonElement).click(); });
    await settle();
    expect(m.dashConversations).toHaveBeenCalledWith({ kind: "preset", days: 90 });
  });

  it("surfaces a failure as a banner with a retry, never as a quiet zero-day", async () => {
    m.dashStats.mockRejectedValue(new Error("stats backend exploded"));
    const el = await mount("admin");
    expect(el.textContent).toContain("Some dashboard data could not be loaded");
    expect(el.textContent).toContain("stats backend exploded");
    const retry = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Retry"));
    expect(retry).toBeTruthy();
    // The KPI row still renders, but with an em dash rather than an invented 0.
    expect(el.textContent).toContain("—");
  });

  it("describes the board in the caller's own terms", async () => {
    // An organization view and a personal view are not the same page; the copy must not
    // tell a plain user they are looking at "who it helped".
    await mount("admin");
    expect(document.body.textContent).toContain("who it helped");
    expect(document.body.textContent).not.toContain("Your conversations");

    await mount("user"); // mount() unmounts the previous tree itself
    expect(document.body.textContent).toContain("Your conversations");
    expect(document.body.textContent).not.toContain("who it helped");
  });
});
