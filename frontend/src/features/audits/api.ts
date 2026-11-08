/** Audit-log feature API (admin; mirrors /api/admin/audits). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function listAudits(params: { limit: number; action?: string }) {
  const qs = new URLSearchParams({ limit: String(params.limit) });
  if (params.action) qs.set("action", params.action);
  const r = await apiFetch(`${BASE}/api/admin/audits?${qs}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { audits, total, actions }
}
