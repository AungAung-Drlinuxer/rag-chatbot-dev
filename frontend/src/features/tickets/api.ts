/** Tickets feature API — list/create/update + comments + attachments (mirrors /api/tickets*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

/** v1.6.3 — active classifier domains for category dropdowns (non-admin). */
export async function listActiveDomains(): Promise<{ key: string; label: string; color?: string }[]> {
  const r = await apiFetch(`${BASE}/api/domains`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  return d?.domains ?? [];
}

export async function listTickets(limit = 50) {
  const r = await apiFetch(`${BASE}/api/tickets?limit=${limit}`, { headers: authHeaders() });
  return r.json();
}

/** v1.6.9 — pull upstream tickets into the local mirror (admin/agent only). */
export async function syncJiraTickets(): Promise<{ ok: boolean; created: number; updated: number; total: number; message?: string }> {
  const r = await apiFetch(`${BASE}/api/tickets/jira/sync`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try { detail = (await r.json())?.detail || detail; } catch { /* non-json */ }
    throw new Error(detail);
  }
  return r.json();
}


/** Ask Jira about every mirrored ticket: drop deleted ones, adopt changed statuses. */
export async function reconcileJiraTickets(): Promise<{
  ok: boolean; checked: number; missing: number; updated: number; revived: number;
  unreachable: number; missing_keys?: string[];
}> {
  const r = await apiFetch(`${BASE}/api/tickets/reconcile`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try { detail = (await r.json())?.detail || detail; } catch { /* non-json */ }
    throw new Error(detail);
  }
  return r.json();
}


export async function listTicketDestinations(): Promise<
  { key: string; label: string; configured: boolean }[]
> {
  const r = await apiFetch(`${BASE}/api/ticket-destinations`, { headers: authHeaders() });
  if (!r.ok) return [{ key: "jira", label: "Jira", configured: false }];
  const d = await r.json();
  return d?.destinations ?? [];
}

export async function createTicketApi(body: {
  subject: string; description: string; domain: string; priority: string;
  assignee?: string | null; due_date?: string | null;
  destination?: string;
  session_id?: string | null;
}) {
  const r = await apiFetch(`${BASE}/api/tickets`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try { detail = (await r.json())?.detail || detail; } catch { /* non-json */ }
    throw new Error(detail);
  }
  return r.json();
}

export async function ticketUpdate(ref: string, patch: {
  status?: string; assignee?: string | null; due_date?: string | null;
  subject?: string; description?: string;
}) {
  const r = await apiFetch(`${BASE}/api/tickets/${ref}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(patch),
  });
  // A refused status change is a 409 with the reason (Jira declined, or no such
  // transition). Returning the body regardless made the page treat it as success and keep
  // the optimistic status, which is how the board drifted away from Jira.
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { detail?: string }));
    throw new Error((body as { detail?: string })?.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function ticketComments(ref: string) {
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/comments`, { headers: authHeaders() });
  return r.json();
}

export async function ticketAddComment(ref: string, body: string) {
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ body }),
  });
  return r.json();
}

export type CategoryAssignee = { username: string; email?: string | null; group?: string | null };

export async function ticketAssignees(domain: string) {
  const q = domain ? `?domain=${encodeURIComponent(domain)}` : "";
  const r = await apiFetch(`${BASE}/api/tickets/assignees${q}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{
    domain: string;
    configured: boolean;
    assignees: CategoryAssignee[];
    default: string | null;
  }>;
}

export async function ticketAttachments(ref: string) {
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/attachments`, { headers: authHeaders() });
  return r.json();
}

/**
 * Base64 without blowing the call stack.
 *
 * `String.fromCharCode(...bytes)` spreads every byte as an argument, so anything past roughly
 * 100 KB throws "Maximum call stack size exceeded" — which surfaced as a generic "Upload
 * failed" for every real attachment. Convert in 32 KB slices instead.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function ticketAttachmentAdd(ref: string, file: File) {
  const buf = await file.arrayBuffer();
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      data_base64: bytesToBase64(new Uint8Array(buf)),
    }),
  });
  // The backend uploads to the Jira issue first; a refusal is a 502 with Jira's reason.
  // Returning the body regardless made the panel say "Attachment added" for a file that
  // never left this app.
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { detail?: string }));
    throw new Error((body as { detail?: string })?.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

export function attachmentUrl(ref: string, id: number) {
  return `${BASE}/api/tickets/${ref}/attachments/${id}/download`;
}
