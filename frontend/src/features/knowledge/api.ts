/** Knowledge feature API — article search/CRUD + Confluence sync (mirrors /api/articles*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function searchArticles(query: string, domain?: string, top_k = 5) {
  const r = await apiFetch(`${BASE}/api/articles/search`, {
    method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ query, domain, top_k }),
  });
  return r.json();
}

export async function createArticle(body: any) {
  const r = await apiFetch(`${BASE}/api/articles`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

export async function updateArticle(page_id: string, body: any) {
  const r = await apiFetch(`${BASE}/api/articles/${page_id}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ ...body, page_id }) });
  return { status: r.status, data: await r.json() };
}

export async function deleteArticle(page_id: string) {
  const r = await apiFetch(`${BASE}/api/articles/${page_id}`, { method: "DELETE", headers: authHeaders() });
  return { status: r.status, data: await r.json() };
}

export async function triggerSync() {
  const r = await apiFetch(`${BASE}/api/articles/sync`, { method: "POST", headers: authHeaders() });
  return { status: r.status, data: await r.json() };
}

export async function articleDraft(topic: string, domain: string) {
  const r = await apiFetch(`${BASE}/api/articles/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ topic, domain }),
  });
  return r.json();
}

// --- KB browse/list (Knowledge page) ---
export async function listArticleDomains() {
  const r = await apiFetch(`${BASE}/api/articles-domains`, { headers: authHeaders() });
  return r.json(); // { domains }
}

export async function listRecentArticles(limit = 8) {
  const r = await apiFetch(`${BASE}/api/articles-recent?limit=${limit}`, { headers: authHeaders() });
  return r.json(); // { articles }
}

export async function getSyncStatus() {
  const r = await apiFetch(`${BASE}/api/sync-status`, { headers: authHeaders() });
  return r.json();
}

export async function listArticles(queryString: string) {
  const r = await apiFetch(`${BASE}/api/articles-list?${queryString}`, { headers: authHeaders() });
  // A 5xx from the list endpoint must THROW, not resolve to a body the page can mistake
  // for "0 articles" — an outage is not an empty knowledge base.
  if (!r.ok) {
    let detail = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      detail = body?.detail ?? body?.error ?? detail;
    } catch {
      /* body was not JSON — keep the status line */
    }
    throw new Error(String(detail));
  }
  return r.json(); // { articles, total, returned, offset, limit }
}

// --- v1.6.47 — bulk operations for the Manage table -------------------------
// Moving or deleting 229 articles one row at a time is not a workflow.
export async function bulkMoveArticles(page_ids: string[], domain: string) {
  const r = await apiFetch(`${BASE}/api/knowledge/articles/bulk-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ page_ids, domain }),
  });
  return { status: r.status, data: await r.json() };
}

export async function bulkDeleteArticles(page_ids: string[]) {
  const r = await apiFetch(`${BASE}/api/knowledge/articles/bulk-delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ page_ids }),
  });
  return { status: r.status, data: await r.json() };
}

export type ArticleSource = { key: string; label: string; count: number };

/** Providers that actually contributed articles (server counts rows, no fixed list). */
export async function listArticleSources(): Promise<{ sources: ArticleSource[] }> {
  const r = await apiFetch(`${BASE}/api/articles-sources`, { headers: { ...authHeaders() } });
  if (!r.ok) throw new Error(`failed to fetch sources (HTTP ${r.status})`);
  return r.json();
}
