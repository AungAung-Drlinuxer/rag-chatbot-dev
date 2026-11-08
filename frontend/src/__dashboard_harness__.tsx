/**
 * Render harness for the dashboard — screenshots and MEASURES it WITHOUT signing in.
 *
 * WHY A HARNESS
 * The dashboard is behind auth and a verification script must not sign in as anyone. This
 * renders the real `Dashboard` page component on the real stylesheet, with `fetch` stubbed
 * to return fixtures whose SHAPES are copied field-for-field from the endpoint returns in
 * `backend/app/api/dashboard.py`. Nothing about the component is mocked or duplicated —
 * only its data source is.
 *
 * What the harness exposes for the shot script:
 *   window.__DASH_REQS__  every request URL the page made, in order. This is how the
 *                         custom-range picker is proven to reach the wire: a date range
 *                         must produce `start=…&end=…`, not a day count.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/dashboard_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import Dashboard from "./features/dashboard/pages/DashboardPage";

declare global {
  interface Window {
    __DASH_REQS__: string[];
    __DASH_HARNESS__?: { role: string; ready: boolean };
  }
}

// --- fixture: the same shapes the endpoints return ---------------------------------
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Mirror of the backend's `_window`: an explicit start/end wins over `days`, the span is
 * clamped to 180 days by moving the START forward, and the effective window is echoed
 * back. The fixture has to behave this way — a fixture that always returned a fixed 7-day
 * window would let a broken picker pass, which is exactly the bug being tested for.
 */
const MAX_WINDOW_DAYS = 180;
function resolveWindow(url: URL) {
  const today = new Date();
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (start && end) {
    let first = new Date(`${start}T00:00:00Z`);
    let last = new Date(`${end}T00:00:00Z`);
    if (first > last) [first, last] = [last, first];
    if (last > today) last = today;
    const span = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
    if (span > MAX_WINDOW_DAYS) first = new Date(last.getTime() - (MAX_WINDOW_DAYS - 1) * 86_400_000);
    const n = Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1;
    return { start: iso(first), end: iso(last), n };
  }
  const n = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 7) || 7, MAX_WINDOW_DAYS));
  const last = today;
  const first = new Date(last.getTime() - (n - 1) * 86_400_000);
  return { start: iso(first), end: iso(last), n };
}

const label = (startIso: string, i: number) =>
  new Date(Date.parse(`${startIso}T00:00:00Z`) + i * 86_400_000).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  });

const convSeries = (startIso: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const total = 34 + Math.round(18 * Math.sin(i / 2.2)) + (i % 5) * 3;
    const escalated = Math.max(0, Math.round(total * 0.18));
    return { day: label(startIso, i), total, resolved: total - escalated, escalated };
  });

const gateSeries = (startIso: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    day: label(startIso, i),
    answered: 28 + Math.round(11 * Math.cos(i / 3)),
    cautioned: 3 + (i % 4),
  }));

/** `?state=degraded` flips the live-looking fixtures into a failing dependency and a low
 *  confidence gate, so the attention strip can be proven to react to real signals.
 *  `?state=empty` is a fresh install with nothing recorded yet. */
const STATE = new URLSearchParams(location.search).get("state") ?? "healthy";
const EMPTY = STATE === "empty";
const DEGRADED = STATE === "degraded";

const ROUTES: Record<string, (url: URL) => unknown> = {
  "/api/dashboard/stats": () => (EMPTY ? null : {
    total_conversations: 412,
    resolved_by_bot: 331,
    escalated_to_tickets: 46,
    active_users: 87,
    kb_pages: 229,
    attacks_blocked_7d: 12,
    window_days: 7,
    deltas: {
      total_conversations: 12.4,
      resolved_by_bot: 8.1,
      escalated_to_tickets: -15.2,
      active_users: 3.6,
    },
  }),
  "/api/dashboard/conversations": (url) => {
    const w = resolveWindow(url);
    return { days: w.n, start: w.start, end: w.end, series: EMPTY ? [] : convSeries(w.start, w.n) };
  },
  "/api/dashboard/gate-trend": (url) => {
    const w = resolveWindow(url);
    if (EMPTY) return { days: w.n, start: w.start, end: w.end, series: [] };
    const series = gateSeries(w.start, w.n).map((d) => (DEGRADED ? { ...d, cautioned: d.answered, answered: Math.round(d.answered * 0.55) } : d));
    return { days: w.n, start: w.start, end: w.end, series };
  },
  "/api/dashboard/domains": () => (EMPTY ? { total: 0, domains: [] } : {
    total: 412,
    domains: [
      { name: "Database", count: 148, percentage: 35.9 },
      { name: "Network", count: 96, percentage: 23.3 },
      { name: "Security", count: 71, percentage: 17.2 },
      { name: "System", count: 62, percentage: 15.0 },
      { name: "Other", count: 35, percentage: 8.5 },
    ],
  }),
  "/api/dashboard/recent-conversations": () => (EMPTY ? { conversations: [] } : {
    conversations: [
      { time: "2026-10-30T09:41:00+08:00", user: "aung.lae", question: "How do I fix a PostgreSQL connection timeout?", result: "Escalated" },
      { time: "2026-10-30T09:12:00+08:00", user: "kyaw.zin", question: "VPN drops every ten minutes since this morning.", result: "Escalated" },
      { time: "2026-10-30T08:55:00+08:00", user: "su.myat", question: "Reset my AD password please.", result: "Cautioned" },
      { time: "2026-10-29T17:20:00+08:00", user: "htet.naing", question: "Printer queue is stuck again.", result: "Resolved" },
      { time: "2026-10-29T16:02:00+08:00", user: "nilar.win", question: "Server disk usage above 85% on app-02.", result: "Resolved" },
      { time: "2026-10-29T14:38:00+08:00", user: "zaw.min", question: "Kubectl get nodes shows one node NotReady.", result: "Resolved" },
    ],
  }),
  "/api/dashboard/recent-tickets": () => (EMPTY ? { tickets: [] } : {
    tickets: [
      { id: "ITHD-4821", subject: "Outlook cannot connect after password reset", status: "Open", priority: "High" },
      { id: "ITHD-4790", subject: "Laptop will not resume from sleep", status: "Pending", priority: "Medium" },
      { id: "ITHD-4772", subject: "Shared drive permission denied for finance", status: "Resolved", priority: "High" },
      { id: "ITHD-4755", subject: "VPN certificate expired", status: "Resolved", priority: "Critical" },
      { id: "ITHD-4741", subject: "New starter account provisioning", status: "Open", priority: "Low" },
    ],
  }),
  "/api/dashboard/health": () => ({
    overall: DEGRADED ? "Degraded" : "Healthy",
    down: DEGRADED ? ["Redis"] : [],
    services: [
      { key: "postgres", name: "PostgreSQL", status: "Healthy", detail: null, latency_ms: 4 },
      { key: "redis", name: "Redis", status: DEGRADED ? "Down" : "Healthy", detail: DEGRADED ? "connection refused" : null, latency_ms: DEGRADED ? null : 2 },
      { key: "rerank", name: "Rerank service", status: "Healthy", detail: null, latency_ms: 38 },
      { key: "llm", name: "LLM gateway", status: "Healthy", detail: null, latency_ms: 210 },
      { key: "neo4j", name: "Neo4j", status: "Healthy", detail: null, latency_ms: 9 },
    ],
    security: { guardrail_events_7d: DEGRADED ? 27 : 12 },
  }),
};

window.__DASH_REQS__ = [];
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  window.__DASH_REQS__.push(url);
  const parsed = new URL(url, window.location.origin);
  const make = ROUTES[parsed.pathname];
  if (!make) return realFetch(input as RequestInfo, init);
  return new Response(JSON.stringify(make(parsed)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

const role = new URLSearchParams(location.search).get("role") === "user" ? "user" : "admin";

createRoot(document.getElementById("root")!).render(
  <Dashboard role={role} userName="Aung Lae" />,
);

window.__DASH_HARNESS__ = { role, ready: true };
