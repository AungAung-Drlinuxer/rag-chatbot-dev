/** Domains feature API — CRUD for routing domains and classifier keywords. */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type ClassifierDomainItem = {
  id: number;
  domain_key: string;
  display_name: string;
  description: string | null;
  keywords: string[];
  jira_project: string | null;
  jira_assignee: string | null;
  icon?: string | null;
  color?: string | null;
  custom_icon?: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export async function getClassifierDomains(): Promise<{ domains: ClassifierDomainItem[] }> {
  const r = await apiFetch(`${BASE}/api/admin/domains`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(`failed to fetch domains (HTTP ${r.status})`);
  return r.json();
}

export async function createClassifierDomain(data: {
  domain_key: string;
  display_name: string;
  description?: string;
  keywords: string[];
  jira_project?: string;
  jira_assignee?: string;
  icon?: string;
  color?: string;
  custom_icon?: string | null;
  is_active?: boolean;
}): Promise<{ status: string; id: number; domain_key: string }> {
  const r = await apiFetch(`${BASE}/api/admin/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `failed to create domain (HTTP ${r.status})`);
  }
  return r.json();
}

export async function updateClassifierDomain(
  id: number,
  data: Partial<{
    display_name: string;
    description: string;
    keywords: string[];
    jira_project: string;
    jira_assignee: string;
    icon: string;
    color: string;
    custom_icon?: string | null;
    is_active: boolean;
  }>
): Promise<{ status: string; id: number; domain_key: string }> {
  const r = await apiFetch(`${BASE}/api/admin/domains/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `failed to update domain (HTTP ${r.status})`);
  }
  return r.json();
}

export async function renameClassifierDomain(
  id: number,
  new_domain_key: string
): Promise<{ status: string; id: number; old_domain_key: string; domain_key: string; kb_pages_migrated: number }> {
  const r = await apiFetch(`${BASE}/api/admin/domains/${id}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ new_domain_key }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `failed to rename domain (HTTP ${r.status})`);
  }
  return r.json();
}

export async function deleteClassifierDomain(id: number): Promise<{ status: string; action: string }> {
  const r = await apiFetch(`${BASE}/api/admin/domains/${id}`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail || `failed to delete domain (HTTP ${r.status})`);
  }
  return r.json();
}
