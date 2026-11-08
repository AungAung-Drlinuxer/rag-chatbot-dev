/**
 * P3c — KB re-classification audit client.
 *
 * The run makes one LLM call per article (minutes), so it is started in the
 * background and polled. Nothing is written until the admin applies the diff.
 */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type ReclassifyChange = {
  page_id: string;
  title: string;
  current: string;
  suggested: string;
  confidence: number;
  reason: string;
};

export type ReclassifyStatus = {
  state: "idle" | "running" | "done" | "error";
  total: number;
  done: number;
  changed: number;
  started_at: number | null;
  finished_at: number | null;
  applied: boolean;
  applied_count?: number;
  error: string | null;
  changes: ReclassifyChange[];
};

export async function startReclassify(apply: boolean, limit = 250) {
  const r = await apiFetch(`${BASE}/api/knowledge/reclassify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ apply, limit }),
  });
  return { status: r.status, data: (await r.json()) as { started: boolean; reason?: string } };
}

export async function getReclassifyStatus(): Promise<ReclassifyStatus> {
  const r = await apiFetch(`${BASE}/api/knowledge/reclassify/status`, { headers: authHeaders() });
  return (await r.json()) as ReclassifyStatus;
}
