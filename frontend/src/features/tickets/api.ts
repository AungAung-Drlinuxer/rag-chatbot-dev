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

export async function ticketAttachments(ref: string) {
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/attachments`, { headers: authHeaders() });
  return r.json();
}

export async function ticketAttachmentAdd(ref: string, file: File) {
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const r = await apiFetch(`${BASE}/api/tickets/${ref}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ filename: file.name, content_type: file.type, data_base64: b64 }),
  });
  return r.json();
}

export function attachmentUrl(ref: string, id: number) {
  return `${BASE}/api/tickets/${ref}/attachments/${id}/download`;
}
