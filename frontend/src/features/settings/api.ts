/** Settings feature API — user prefs, admin knobs, SMTP + integration config (mirrors /api/settings*, /api/admin/settings*, /api/integrations*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type UserSettings = {
  username?: string;
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  chat_font_size: number;
  /** Legacy JSON preferences still used by the appearance engine. */
  compact?: boolean;
  animations?: boolean;
  darkMode?: boolean;
  code_font: string;
  show_token_usage: boolean;
  show_rag_sources: boolean;
  stream_responses: boolean;
  markdown_rendering: boolean;
  auto_escalate_on_caution: boolean;
  history_retention_days: number;
  escalate_include_transcript: boolean;
  escalate_include_sources: boolean;
  escalate_open_new_tab: boolean;
  updated_at?: string | null;
};

export type Knob = { key: string; type: string; default: number | string; current: number | string; overridden: boolean };

export type IntegrationStatus = Record<string, any>;

// --- user settings (two historical spellings kept for compatibility) ---
export async function getUserSettings(): Promise<{ settings: Record<string, any> }> {
  const r = await apiFetch(`${BASE}/api/settings`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(`settings fetch failed (HTTP ${r.status})`);
  return r.json();
}

export async function putUserSettings(settings: Record<string, any>) {
  const r = await apiFetch(`${BASE}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ settings }),
  });
  if (!r.ok) {
    let msg = `settings save failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function getMySettings(): Promise<UserSettings | Record<string, any>> {
  const r = await apiFetch(`${BASE}/api/settings`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  // Backend returns flat user preferences dict directly on /api/settings.
  // Handle both flat { theme, darkMode, ... } or legacy wrapped { settings: {...} }.
  if (j && typeof j === "object") {
    if (j.settings && typeof j.settings === "object") {
      return { ...j, ...j.settings };
    }
    return j;
  }
  return {};
}

/**
 * Save preferences. PUT /api/settings REPLACES the whole prefs blob and expects it
 * wrapped as `{settings: {...}}`, so a partial patch is merged over the current
 * values first — otherwise saving one toggle would drop every other preference
 * (theme, font size, and now the per-user integration opt-ins).
 */
export async function updateMySettings(patch: Partial<UserSettings> | Record<string, any>): Promise<UserSettings> {
  let merged: Record<string, any> = { ...patch };
  try {
    const current = await getMySettings();
    const base = (current as any)?.settings && typeof (current as any).settings === "object"
      ? { ...(current as any), ...(current as any).settings }
      : { ...(current as any) };
    delete base.username;
    delete base.settings;
    merged = { ...base, ...patch };
  } catch {
    /* first save / offline: fall back to the patch alone */
  }
  const r = await apiFetch(`${BASE}/api/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ settings: merged }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json().catch(() => ({}));
  return body?.settings ? { ...body.settings, ...body } : body;
}

// --- admin knobs ---
export async function getAdminSettings(): Promise<{ knobs: Knob[] }> {
  const r = await apiFetch(`${BASE}/api/admin/settings`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function saveAdminSettings(knobs: Record<string, number | string>) {
  const r = await apiFetch(`${BASE}/api/admin/settings`, {
    method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ knobs }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { applied, knobs }
}

export async function resetAdminSetting(key: string) {
  const r = await apiFetch(`${BASE}/api/admin/settings/${key}`, { method: "DELETE", headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { reset: key }
}

// --- SMTP ---
export async function getSmtpSettings(): Promise<{ smtp: Record<string, any> }> {
  const r = await apiFetch(`${BASE}/api/settings/smtp`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(`SMTP settings fetch failed (HTTP ${r.status})`);
  return r.json();
}

export async function putSmtpSettings(smtp: Record<string, any>): Promise<{ ok: boolean }> {
  const r = await apiFetch(`${BASE}/api/settings/smtp`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ smtp }),
  });
  if (!r.ok) {
    let msg = `SMTP save failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export async function sendTestEmail(to: string): Promise<{ ok: boolean; to: string }> {
  const r = await apiFetch(`${BASE}/api/settings/smtp/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ to }),
  });
  if (!r.ok) {
    let msg = `Test email failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

// --- integrations ---
/** v1.6.35 — integration config is write-only: values come back masked, and the
 *  response carries `fields_set` / `secret_fields` flags to render from instead. */
export type IntegrationSettingsResponse = {
  integration: string;
  configured?: boolean;
  settings: Record<string, any>;
  fields_set?: string[];
  secret_fields?: string[];
  mask?: string;
  updated_at?: string | null;
  token_set?: boolean;
};

export async function getIntegrationSettings(key: string): Promise<IntegrationSettingsResponse> {
  const r = await apiFetch(`${BASE}/api/settings/integrations/${key}`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(`integration settings fetch failed (HTTP ${r.status})`);
  return r.json();
}

export async function putIntegrationSettings(key: string, settings: Record<string, any>): Promise<{ ok: boolean }> {
  const r = await apiFetch(`${BASE}/api/settings/integrations/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ settings }),
  });
  if (!r.ok) {
    let msg = `integration save failed (HTTP ${r.status})`;
    try { const j = await r.json(); if (j?.detail) msg = String(j.detail); } catch {}
    throw new Error(msg);
  }
  return r.json();
}

/** v1.6.35 — revoke a stored integration config. Needed because credentials are
 *  write-only and an empty field means "keep the stored value", so this is the
 *  only way for an admin to remove a saved token. */
export async function deleteIntegrationSettings(key: string): Promise<{ ok: boolean; cleared?: boolean }> {
  // `confirm` is required: the removal is unrecoverable.
  const r = await apiFetch(
    `${BASE}/api/settings/integrations/${key}?confirm=${encodeURIComponent(key)}`,
    { method: "DELETE", headers: authHeaders() }
  );
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function testIntegration(key: string): Promise<{ ok: boolean; status?: number; detail?: string; user?: string; error?: string }> {
  const r = await apiFetch(`${BASE}/api/settings/integrations/${key}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
  });
  try {
    return await r.json();
  } catch {
    return { ok: false, detail: `Test failed (HTTP ${r.status})` };
  }
}


export type ProviderModel = { id: string; name: string };

export async function getLlmModels(): Promise<{ models: ProviderModel[]; count: number }> {
  const r = await apiFetch(`${BASE}/api/settings/integrations/llm/models`, { headers: { ...authHeaders() } });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j?.detail || `model list failed (HTTP ${r.status})`);
  }
  return r.json();
}

export async function getIntegrationsStatus(): Promise<IntegrationStatus> {
  const r = await apiFetch(`${BASE}/api/integrations/status`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// --- runtime knobs (v0.21.83 — admin RAG params, 403 for other roles) ---
export async function getRuntime(): Promise<any | null> {
  const r = await apiFetch(`${BASE}/api/runtime`, { headers: authHeaders() });
  return r.ok ? r.json() : null;
}

export async function putRuntime(overrides: Record<string, number>) {
  const r = await apiFetch(`${BASE}/api/runtime`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ overrides }),
  });
  return r.json().catch(() => ({}));
}


// --- Dynamic Domain & Classifier Management ---

export type ClassifierDomainItem = {
  id: number;
  domain_key: string;
  display_name: string;
  description: string | null;
  keywords: string[];
  jira_project: string | null;
  jira_assignee: string | null;
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

export type SetupStep = {
  key: string;
  label: string;
  status: "done" | "todo" | "blocked";
  detail: string;
  hint?: string;
};

export type SetupReadiness = {
  ready: boolean;
  steps: SetupStep[];
  database: { tables: number; vector_version: string | null; checkpoints: boolean; ok: boolean };
  knowledge: {
    confluence_configured: boolean; spaces: string[]; articles: number; domains: number;
    last_sync: { at?: string; inserted?: number; updated?: number; skipped?: number } | null;
  };
};

/** What is still missing before this install is usable (GET /api/setup/readiness). */
export async function getSetupReadiness(): Promise<SetupReadiness> {
  const r = await apiFetch(`${BASE}/api/setup/readiness`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`setup readiness failed: ${r.status}`);
  return r.json();
}

// --- Multi-site connections (v1.11.28) --------------------------------------
// One row per Confluence/Jira site. The legacy `settings/integrations/{key}` object is the
// single-site path and still works; these endpoints are what the Sites list uses.
export type Connection = {
  id: number;
  provider: "confluence" | "jira";
  label: string;
  base_url: string;
  email: string;
  cloud_id: string;
  spaces: string[];
  project_key: string;
  active: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  token_set?: boolean;
};

export async function listConnections(provider: "confluence" | "jira"): Promise<{ connections: Connection[] }> {
  const r = await apiFetch(`${BASE}/api/settings/connections?provider=${provider}`, {
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function createConnection(payload: Partial<Connection> & { api_token?: string }) {
  const r = await apiFetch(`${BASE}/api/settings/connections`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
  return body;
}

export async function updateConnection(id: number, payload: Partial<Connection> & { api_token?: string }) {
  const r = await apiFetch(`${BASE}/api/settings/connections/${id}`, {
    method: "PUT",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`);
  return body;
}

export async function deleteConnection(id: number, label: string) {
  const r = await apiFetch(
    `${BASE}/api/settings/connections/${id}?confirm=${encodeURIComponent(label)}`,
    { method: "DELETE", headers: authHeaders() },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function testConnection(id: number): Promise<{ ok: boolean; status: number | null; detail: string }> {
  const r = await apiFetch(`${BASE}/api/settings/connections/${id}/test`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
