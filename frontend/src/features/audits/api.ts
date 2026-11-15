/** Audit-log feature API (admin; mirrors /api/admin/audits). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function listAudits(params: {
  limit: number;
  offset?: number;
  action?: string;
  q?: string;
  result?: string;
  from?: string;
  to?: string;
  order?: "asc" | "desc";
}) {
  const qs = new URLSearchParams({ limit: String(params.limit) });
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.action) qs.set("action", params.action);
  if (params.q?.trim()) qs.set("q", params.q.trim());
  if (params.result) qs.set("result", params.result);
  if (params.from) qs.set("date_from", params.from);
  if (params.to) qs.set("date_to", params.to);
  if (params.order) qs.set("order", params.order);
  const r = await apiFetch(`${BASE}/api/admin/audits?${qs}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { audits, total, actions, today, users }
}
