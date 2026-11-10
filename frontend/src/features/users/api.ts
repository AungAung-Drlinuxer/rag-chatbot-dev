/** Users & RBAC feature API (mirrors /api/users*, /api/rbac/*, /api/audits). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function updateUserRole(username: string, role: string) {
  // Normalize display labels (IT Support / Knowledge Manager) to backend enum
  const norm = (role || "").trim().toLowerCase()
    .replace(/^it support$/, "user")
    .replace(/^knowledge manager$/, "knowledge")
    .replace(/^administrator$/, "admin")
    .replace(/^user$/, "user");
  const r = await apiFetch(`${BASE}/api/users/${encodeURIComponent(username)}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ role: norm }),
  });
  if (!r.ok) {
    let msg = `role update failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function updateUserStatus(username: string, enabled: boolean) {
  const r = await apiFetch(`${BASE}/api/users/${encodeURIComponent(username)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ enabled }),
  });
  if (!r.ok) {
    let msg = `status update failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function resetUserAccess(username: string) {
  const r = await apiFetch(`${BASE}/api/users/${encodeURIComponent(username)}/reset-access`, {
    method: "POST", headers: { ...authHeaders() },
  });
  if (!r.ok) {
    let msg = `reset failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function assignableUsers() {
  const r = await apiFetch(`${BASE}/api/users/assignable`, { headers: authHeaders() });
  return r.json();
}

// --- admin user directory (Users page + conversation filter dropdown) ---
export async function listUsers() {
  const r = await apiFetch(`${BASE}/api/users`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function getUserPermissions(username: string) {
  const r = await apiFetch(`${BASE}/api/users/${encodeURIComponent(username)}/permissions`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function setUserPassword(username: string, password: string) {
  const r = await apiFetch(`${BASE}/api/users/${encodeURIComponent(username)}/password`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function createUser(body: {
  username: string; name: string; email: string; department: string; role: string; password: string;
}) {
  const r = await apiFetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

export async function getRbacMatrix(): Promise<{ matrix: any[]; editable: boolean }> {
  const r = await apiFetch(`${BASE}/api/rbac/matrix`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`matrix fetch failed (HTTP ${r.status})`);
  return r.json();
}

export async function putRbacMatrix(matrix: any[]) {
  const r = await apiFetch(`${BASE}/api/rbac/matrix`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ matrix }),
  });
  if (!r.ok) {
    let msg = `matrix update failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}


/* ---------------------------------------------------------------- app groups */

export type AppGroup = { name: string; description?: string | null; role: string; members: string[] };

export async function listGroups(): Promise<{ groups: AppGroup[] }> {
  const r = await apiFetch(`${BASE}/api/admin/groups`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function createGroup(name: string, members: string[] = []) {
  const r = await apiFetch(`${BASE}/api/admin/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ name, members, role: "knowledge" }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { detail?: string }));
    throw new Error((body as { detail?: string })?.detail || `HTTP ${r.status}`);
  }
  return r.json() as Promise<{ groups: AppGroup[] }>;
}

export async function updateGroupMembers(name: string, members: string[]) {
  const r = await apiFetch(`${BASE}/api/admin/groups/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ members }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { detail?: string }));
    throw new Error((body as { detail?: string })?.detail || `HTTP ${r.status}`);
  }
  return r.json() as Promise<{ groups: AppGroup[] }>;
}

export async function deleteGroup(name: string) {
  const r = await apiFetch(`${BASE}/api/admin/groups/${encodeURIComponent(name)}`, {
    method: "DELETE", headers: { ...authHeaders() },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({} as { detail?: string }));
    throw new Error((body as { detail?: string })?.detail || `HTTP ${r.status}`);
  }
  return r.json() as Promise<{ groups: AppGroup[] }>;
}
