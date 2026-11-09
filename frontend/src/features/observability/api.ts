/** Observability API — all figures come from our own tables, no Prometheus/Grafana. */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type ObservabilityTotals = {
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  max_latency_ms: number;
};

export type ObservabilityDay = {
  day: string;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number | string;
  p95_ms: number | null;
};

export type ObservabilityOverview = {
  range: { start: string; end: string; label: string };
  totals: ObservabilityTotals;
  series: ObservabilityDay[];
  by_model: { model: string; requests: number; tokens_in: number; tokens_out: number; cost: number }[];
  decisions: { decision: string; n: number }[];
  domains: { domain: string; n: number }[];
  guardrails: { action: string; n: number }[];
  guardrail_total: number;
  counts: { kb_articles?: number; tickets_open?: number; users?: number; sessions?: number };
  generated_at: string;
};

export type GuardrailEvent = {
  id?: string | number;
  action: string;
  username: string | null;
  domain: string | null;
  decision: string | null;
  detail: string | null;
  created_at: string | null;
  type?: string;
  risk?: string;
};

export type UsageRange = number | { days?: number; start?: string; end?: string };

/** `7` or `{start, end}` — the Overview board passes whichever range its picker holds. */
export async function getObservabilityOverview(range: UsageRange = 7): Promise<ObservabilityOverview> {
  const qs =
    typeof range === "number"
      ? `days=${range}`
      : range.start && range.end
        ? `start=${range.start}&end=${range.end}`
        : `days=${range.days ?? 7}`;
  const r = await apiFetch(`${BASE}/api/observability/overview?${qs}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`overview failed: HTTP ${r.status}`);
  return r.json();
}

export async function getGuardrailEvents(limit = 25): Promise<{ events: GuardrailEvent[] }> {
  const r = await apiFetch(`${BASE}/api/observability/events?limit=${limit}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`events failed: HTTP ${r.status}`);
  return r.json();
}

/** Dependency health is already computed for the Overview page; reuse it, do not re-probe. */
export async function getServiceHealth(): Promise<{
  services: { key: string; name: string; status: string; latency_ms: number | null; detail: string | null }[];
  overall: string;
  down: string[];
  security?: { guardrail_events_7d?: number };
}> {
  const r = await apiFetch(`${BASE}/api/dashboard/health`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`health failed: HTTP ${r.status}`);
  return r.json();
}
