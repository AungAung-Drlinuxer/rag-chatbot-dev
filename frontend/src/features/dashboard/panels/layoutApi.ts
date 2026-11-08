/** Dashboard layout API — separate module so tests that mock the data endpoints are unaffected. */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";
import type { PanelSpec } from "./types";

export type SavedLayout = {
  panels: PanelSpec[];
  custom: boolean;
  updated_at: string | null;
};

export async function getDashboardLayout(): Promise<SavedLayout> {
  const r = await apiFetch(`${BASE}/api/dashboard/layout`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`layout load failed: ${r.status}`);
  return r.json();
}

export async function saveDashboardLayout(panels: PanelSpec[]): Promise<SavedLayout> {
  const r = await apiFetch(`${BASE}/api/dashboard/layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ panels }),
  });
  if (!r.ok) {
    const detail = await r.json().catch(() => ({}));
    throw new Error(detail?.detail || `layout save failed: ${r.status}`);
  }
  return r.json();
}

export async function resetDashboardLayout(): Promise<SavedLayout> {
  const r = await apiFetch(`${BASE}/api/dashboard/layout`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`layout reset failed: ${r.status}`);
  return r.json();
}
