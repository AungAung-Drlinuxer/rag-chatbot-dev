/** Conversations feature API — history list/rename/pin/delete (mirrors /api/conversations*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type Conv = { session_id: string; title: string; last_at: string | null; messages: number };

export async function listConversations() {
  const r = await apiFetch(`${BASE}/api/conversations`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { conversations: Conv[] }
}

export async function getConversationMessages(sessionId: string) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}/messages`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { session_id, messages: [{role,content,meta,caution,message_id}] }
}

export async function deleteConversation(sessionId: string) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function clearConversations() {
  const r = await apiFetch(`${BASE}/api/conversations`, { method: "DELETE", headers: authHeaders() });
  return r.json(); // { deleted: n }
}

export async function renameConversation(sessionId: string, title: string) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title }),
  });
  if (!r.ok) throw new Error(`rename failed (HTTP ${r.status})`);
  return r.json();
}

export async function pinConversation(sessionId: string, isPinned: boolean) {
  const r = await apiFetch(`${BASE}/api/conversations/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ is_pinned: isPinned }),
  });
  if (!r.ok) throw new Error(`pin failed (HTTP ${r.status})`);
  return r.json();
}
