/** Escalation API — draft a ticket from a conversation, then submit the reviewed text. */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type EscalationFields = {
  configured: boolean;
  projects: { key: string; name?: string }[];
  default_project: string;
  issue_types: { id?: string; name: string }[];
  default_issue_type: string;
  priorities: string[];
  required_fields: { issue_type?: string; fields: { key: string; name: string }[] }[];
};

export type EscalationDraft = {
  draft_id: string;
  session_id: string;
  content_hash: string;
  source: "llm" | "fallback";
  summary: string;
  description: string;
  problem?: string;
  environment?: string;
  symptoms?: string[];
  error_messages?: string[];
  troubleshooting_done?: string[];
  suggested_unverified?: string[];
  current_status?: string;
  escalation_reason?: string;
  business_impact?: string;
  missing_info?: string[];
  kb_links?: { title?: string; url: string }[];
  project: string;
  issue_type: string;
  priority: string;
  custom_fields?: Record<string, unknown>;
};

export type SubmitPayload = {
  draft_id: string;
  base_hash: string;
  summary: string;
  description: string;
  project: string;
  issue_type: string;
  priority: string;
  custom_fields: Record<string, unknown>;
  idempotency_key: string;
};

async function readError(r: Response): Promise<string> {
  try {
    const body = await r.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (detail?.errors?.length) return detail.errors.join(" ");
    if (detail?.message) return detail.message;
    return JSON.stringify(detail ?? body).slice(0, 300);
  } catch {
    return `HTTP ${r.status}`;
  }
}

export async function getEscalationFields(): Promise<EscalationFields> {
  const r = await apiFetch(`${BASE}/api/escalations/fields`, { headers: authHeaders() });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function createEscalationDraft(sessionId: string): Promise<EscalationDraft> {
  const r = await apiFetch(`${BASE}/api/escalations/draft`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}

export async function submitEscalation(payload: SubmitPayload): Promise<{
  jira_key: string;
  link: string;
  duplicate: boolean;
}> {
  const r = await apiFetch(`${BASE}/api/escalations/submit`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(await readError(r));
  return r.json();
}
