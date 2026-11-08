/** Dashboard feature API (mirrors /api/dashboard*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

/**
 * Reporting window, resolved once and shared by every series endpoint.
 *
 * `preset` and `custom` are mutually exclusive ways to express the SAME thing, so the
 * query string is built in one place: a custom window sends `start`+`end` (a real date
 * range — "March" cannot be expressed as a day count), a preset sends `days`.
 */
export type ReportWindow =
  | { kind: "preset"; days: number }
  | { kind: "custom"; start: string; end: string };

export function windowQuery(w: ReportWindow): string {
  return w.kind === "custom"
    ? `start=${encodeURIComponent(w.start)}&end=${encodeURIComponent(w.end)}`
    : `days=${w.days}`;
}

export async function dashStats() {
  const r = await apiFetch(`${BASE}/api/dashboard/stats`, { headers: authHeaders() });
  return r.json();
}

export async function dashConversations(w: ReportWindow = { kind: "preset", days: 7 }) {
  const r = await apiFetch(`${BASE}/api/dashboard/conversations?${windowQuery(w)}`, {
    headers: authHeaders(),
  });
  return r.json();
}

export async function dashDomains() {
  const r = await apiFetch(`${BASE}/api/dashboard/domains`, { headers: authHeaders() });
  return r.json();
}

export async function dashRecentConversations(limit = 10) {
  const r = await apiFetch(`${BASE}/api/dashboard/recent-conversations?limit=${limit}`, { headers: authHeaders() });
  return r.json();
}

export async function dashRecentTickets(limit = 5) {
  const r = await apiFetch(`${BASE}/api/dashboard/recent-tickets?limit=${limit}`, { headers: authHeaders() });
  return r.json();
}

export async function dashGateTrend(w: ReportWindow = { kind: "preset", days: 7 }) {
  const r = await apiFetch(`${BASE}/api/dashboard/gate-trend?${windowQuery(w)}`, {
    headers: authHeaders(),
  });
  return r.json();
}

export async function dashHealth() {
  const r = await apiFetch(`${BASE}/api/dashboard/health`, { headers: authHeaders() });
  return r.json();
}
