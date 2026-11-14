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

export function adminConversationExportUrl(
  sessionId: string,
  format: "txt" | "json",
  onBehalfOf?: string,
) {
  const who = onBehalfOf ? `&on_behalf_of=${encodeURIComponent(onBehalfOf)}` : "";
  return `${BASE}/api/admin/conversations/${sessionId}/export?format=${format}${who}`;
}

/** Administrators an export can be recorded for (the picker in the export dialog). */
export async function adminListAdmins(): Promise<{ username: string; email?: string }[]> {
  try {
    const r = await apiFetch(`${BASE}/api/admin/admins`, { headers: authHeaders() });
    if (!r.ok) return [];
    const d = await r.json();
    return d?.admins ?? [];
  } catch {
    return [];
  }
}

export async function adminDownloadConversation(
  sessionId: string,
  format: "txt" | "json",
  onBehalfOf?: string,
): Promise<Response> {
  return apiFetch(adminConversationExportUrl(sessionId, format, onBehalfOf), {
    headers: authHeaders(),
  });
}
