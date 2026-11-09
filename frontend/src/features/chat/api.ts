/** Chat feature API — SSE stream, feedback, escalation (mirrors /api/chat, /api/feedback, /api/escalate). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function streamChat(
  message: string,
  sessionId: string,
  history: { role: string; content: string }[],
  onEvent: (e: { event: string; data: any }) => void,
  llmProvider?: "auto" | "cloud" | "local",
  signal?: AbortSignal
) {
  const res = await apiFetch(`${BASE}/api/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      message, session_id: sessionId, context: history,
      llm_provider: llmProvider ?? "auto",
    }),
    signal,
  });
  if (res.status === 401) throw new Error("Session expired — please log in again");
  if (res.status === 429) {
    // The limiter sends Retry-After; "HTTP 429" told the user nothing they could act on.
    const wait = Number(res.headers.get("retry-after") || 0) || 5;
    throw new Error(`Too many requests — please wait ${wait}s and try again.`);
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) onEvent({ event, data: JSON.parse(data) });
    }
  }
}

export async function escalate(body: any) {
  const r = await apiFetch(`${BASE}/api/escalate`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body),
  });
  return r.json();
}

export async function getContact(domain: string) {
  const r = await apiFetch(`${BASE}/api/contacts/${domain}`, { headers: authHeaders() });
  return r.json();
}

export async function listEscalations() {
  const r = await apiFetch(`${BASE}/api/escalations`, { headers: authHeaders() });
  return r.json();
}

export async function submitFeedback(message_id: string | null, rating: number, comment?: string) {
  const r = await apiFetch(`${BASE}/api/feedback`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message_id, rating, comment }),
  });
  return r.json();
}

export async function uploadAttachment(file: File, sessionId: string): Promise<{ id: string; filename: string; mime: string; size: number }> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("session_id", sessionId);
  const r = await apiFetch(`${BASE}/api/attachments`, { method: "POST", body: fd, headers: { ...authHeaders() } });
  if (!r.ok) {
    let msg = `upload failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// --- admin approval queue (HITL) — absolute BASE like every other call; the old
// relative "/api/approvals" depended on a dev proxy and breaks outside it ---
export async function listApprovals(): Promise<{ approvals: any[] }> {
  const r = await apiFetch(`${BASE}/api/approvals`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// v1.6.40 — "cancelled" lets the requester supersede their own escalation with a
// direct ticket-form submission (no graph resume, so no duplicate ticket).
export async function decideApproval(
  id: string,
  decision: "approved" | "rejected" | "cancelled",
) {
  const r = await apiFetch(`${BASE}/api/approvals/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  return r.json().catch(() => ({}));
}

/** Persist a conversation-level setting (title, pin).
 *
 * PATCHes `/api/conversations/{id}`, so the ownership check and the 404 semantics are
 * already in place.
 */
export async function patchConversation(sessionId: string, body: Record<string, unknown>) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`patch conversation failed: ${r.status}`);
  return r.json();
}
