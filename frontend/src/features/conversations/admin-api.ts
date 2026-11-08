/** Admin conversation-browser API (mirrors /api/admin/conversations*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function adminListConversations(username?: string) {
  const u = username ? `&username=${encodeURIComponent(username)}` : "";
  const r = await apiFetch(`${BASE}/api/admin/conversations?limit=200${u}`, { headers: authHeaders() });
  return r.json(); // { conversations }
}

export async function adminConversationMessages(sessionId: string) {
  const r = await apiFetch(`${BASE}/api/admin/conversations/${sessionId}/messages`, { headers: authHeaders() });
  return r.json(); // { username, messages }
}

export function adminConversationExportUrl(sessionId: string, format: "txt" | "json") {
  return `${BASE}/api/admin/conversations/${sessionId}/export?format=${format}`;
}

export async function adminDownloadConversation(sessionId: string, format: "txt" | "json"): Promise<Response> {
  return apiFetch(adminConversationExportUrl(sessionId, format), { headers: authHeaders() });
}
