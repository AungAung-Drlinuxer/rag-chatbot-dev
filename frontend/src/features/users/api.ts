/** Users & RBAC feature API (mirrors /api/users*, /api/rbac/*, /api/audits). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function updateUserRole(username: string, role: string) {
  // Normalize display labels (IT Support / Knowledge Manager) to backend enum
  const norm = (role || "").trim().toLowerCase()
    .replace(/^it support$/, "agent")
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

export async function listDepartments() {
  const r = await apiFetch(`${BASE}/api/departments`, { headers: authHeaders() });
  return r.ok ? r.json() : null; // supporting data — non-fatal
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
