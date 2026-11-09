/**
 * Render harness for the Knowledge Base page — screenshots it WITHOUT logging in.
 *
 * WHY A HARNESS
 * The app is behind auth and a verification script must not sign in as anyone. This
 * renders the SAME KnowledgePage the app renders, on the SAME stylesheet, with `fetch`
 * stubbed to return payloads in the exact shape the backend sends.
 *
 * WHERE THE DATA COMES FROM (nothing here is invented)
 *   - `disk-usage.txt` and `print-spooler.md` are the real seed articles in
 *     `backend/kb_files/`, and their titles are the real H1s of those files.
 *   - The remaining titles are the real article titles used by
 *     `backend/scripts/eval_goldset.py` (the retrieval goldset) — the same titles the
 *     sources harness uses.
 *   - `source_url` hosts are real Atlassian/Jira/Notion hosts, so `providerOf()` resolves
 *     each row to the provider the URL actually implies rather than to a default.
 *   - `sync-status` and `articles-domains` mirror the real backend response shapes.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/knowledge_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import KnowledgePage from "./features/knowledge/pages/KnowledgePage";

declare global {
  interface Window {
    __KB_HARNESS__?: { scenario: string; ready: boolean; calls: string[] };
  }
}

const scenario = new URLSearchParams(location.search).get("scenario") ?? "list";

const NOW = Date.now();
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

/** Real seed articles from backend/kb_files/ first, then real goldset titles. */
const ARTICLES = [
  {
    page_id: "kb-disk-usage",
    title: "Server Disk Usage Above 85% — Free Space Runbook",
    domain: "system",
    last_synced: ago(12),
    source_url: "https://kb.drlinuxer.com/articles/disk-usage",
  },
  {
    page_id: "kb-print-spooler",
    title: "Runbook — Restart the Print Spooler",
    domain: "system",
    last_synced: ago(40),
    source_url: "https://kb.drlinuxer.com/articles/print-spooler",
  },
  {
    page_id: "kb-database-timeout",
    title: "Database Connection Timeout — Troubleshooting Guide",
    domain: "database",
    last_synced: ago(95),
    source_url: "https://kb.drlinuxer.com/articles/database-connection-timeout",
  },
  {
    page_id: "kb-reset-ad-password",
    title: "Reset AD Password",
    domain: "security",
    last_synced: ago(180),
    source_url: "https://kb.drlinuxer.com/articles/reset-ad-password",
  },
  {
    page_id: "kb-password-expired",
    title: "Password Expired — Re-sync MFA and Unlock Account",
    domain: "security",
    last_synced: ago(300),
    source_url: "https://kb.drlinuxer.com/articles/password-expired",
  },
  {
    page_id: "kb-vpn-disconnects",
    title: "VPN Gateway Disconnects — Troubleshooting",
    domain: "network",
    last_synced: ago(1440),
    source_url: "https://kb.drlinuxer.com/articles/vpn-disconnects",
  },
  {
    page_id: "kb-kubectl-nodes",
    title: "Kubectl get nodes — Live Cluster Check",
    domain: "kubernetes",
    last_synced: ago(2880),
    source_url: "https://kb.drlinuxer.com/articles/kubectl-get-nodes",
  },
  {
    // No source_url — exercises the branch where the provider badge is NOT a link.
    page_id: "kb-onboarding-checklist",
    title: "New Starter IT Onboarding Checklist",
    domain: "general",
    last_synced: null,
    source_url: null,
  },
];

/**
 * PAGINATION FIXTURE — 47 rows so the pager has several pages to walk. The rows reuse the
 * real titles above and differ only by the host they were captured from; this file is a QA
 * harness and is never part of the shipped bundle.
 */
const HOSTS = ["app-01", "app-02", "db-01", "db-02", "vpn-gw-1", "fw-01", "k8s-node-2", "print-01"];
const PAGED = Array.from({ length: 47 }, (_, i) => {
  const base = ARTICLES[i % ARTICLES.length];
  return {
    ...base,
    page_id: `${base.page_id}-${i}`,
    title: `${base.title.replace(/ — .*$/, "")} · ${HOSTS[i % HOSTS.length]} · case ${String(i + 1).padStart(2, "0")}`,
    last_synced: base.last_synced,
  };
});

/** Per-domain counts must match PAGED, or the chips contradict the table. */
const countIn = (d: string) => PAGED.filter((a) => a.domain === d).length;

const DOMAIN_CARDS = [
  { domain: "all", display_name: "All Domains", description: null, icon: null, color: null, custom_icon: null, pages: PAGED.length, last_synced: ago(12) },
  { domain: "system", display_name: "System & Endpoint", description: "Operating system, hardware and endpoint troubleshooting runbooks.", icon: "Monitor", color: "blue", custom_icon: null, pages: countIn("system"), last_synced: ago(12) },
  { domain: "database", display_name: "Database", description: "PostgreSQL, pooling, locking and query performance procedures.", icon: "Database", color: "indigo", custom_icon: null, pages: countIn("database"), last_synced: ago(95) },
  { domain: "security", display_name: "Identity & Security", description: "Active Directory, password, MFA and account access procedures.", icon: "ShieldCheck", color: "sky", custom_icon: null, pages: countIn("security"), last_synced: ago(180) },
  { domain: "network", display_name: "Network", description: "VPN, DNS, firewall and connectivity troubleshooting.", icon: "Network", color: "emerald", custom_icon: null, pages: countIn("network"), last_synced: ago(1440) },
  { domain: "kubernetes", display_name: "Kubernetes", description: "Cluster operations, workloads and read-only diagnostics.", icon: "Boxes", color: "violet", custom_icon: null, pages: countIn("kubernetes"), last_synced: ago(2880) },
  { domain: "general", display_name: "General IT", description: "Short description", icon: "FolderTree", color: "slate", custom_icon: null, pages: countIn("general"), last_synced: null },
];

const CLASSIFIER_DOMAINS = [
  { id: 1, domain: "system", display_name: "System & Endpoint", description: "Operating system, hardware and endpoint troubleshooting runbooks." },
  { id: 2, domain: "database", display_name: "Database", description: "PostgreSQL, pooling, locking and query performance procedures." },
  { id: 3, domain: "security", display_name: "Identity & Security", description: "Active Directory, password, MFA and account access procedures." },
  { id: 4, domain: "network", display_name: "Network", description: "VPN, DNS, firewall and connectivity troubleshooting." },
  { id: 5, domain: "kubernetes", display_name: "Kubernetes", description: "Cluster operations, workloads and read-only diagnostics." },
  { id: 6, domain: "general", display_name: "General IT", description: "Short description" },
];

const SYNC_STATUS = {
  pages: PAGED.length,
  last_run: { at: ago(12), duration_ms: 4210, pages_created: 2, pages_updated: 6 },
  healthy: true,
  beat_interval_minutes: 30,
};

const calls: string[] = [];
window.__KB_HARNESS__ = { scenario, ready: false, calls };

/**
 * Stub `fetch` per endpoint. Matching is on the path, and anything unmatched returns an
 * empty list rather than a 404 so an unrelated call cannot make the page look broken.
 */
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  calls.push(url);
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (scenario === "error" && (path === "/api/articles-list" || path === "/api/articles-list/")) {
    return new Response(JSON.stringify({ detail: "knowledge base unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  switch (path) {
    case "/api/articles/search": {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const q = String(body.query ?? "").toLowerCase();
      const hits = PAGED.filter((a) => a.title.toLowerCase().includes(q)).slice(0, Number(body.top_k ?? 5));
      return json({ data: { articles: hits } });
    }
    case "/api/articles-list": {
      const u = new URL(url, location.origin);
      const limit = Math.max(1, Math.min(Number(u.searchParams.get("limit") ?? 10) || 10, 200));
      const offset = Math.max(0, Number(u.searchParams.get("offset") ?? 0) || 0);
      const sort = u.searchParams.get("sort") ?? "last_synced";
      const order = (u.searchParams.get("order") ?? "desc") === "asc" ? 1 : -1;
      const domain = u.searchParams.get("domain");
      const q = (u.searchParams.get("q") ?? "").toLowerCase();
      const provider = u.searchParams.get("provider");
      const matchProvider = (a: { source_url?: string | null }) =>
        provider === "confluence" ? /atlassian\.net/.test(a.source_url ?? "")
          : provider === "notion" ? /notion\./.test(a.source_url ?? "")
            : true;

      const rows = PAGED
        .filter((a) => (domain ? a.domain === domain : true))
        .filter((a) => (provider ? matchProvider(a) : true))
        .filter((a) => (!q ? true : `${a.title}`.toLowerCase().includes(q)))
        .sort((a: any, b: any) => {
          if (sort === "title") return a.title.localeCompare(b.title) * order;
          if (sort === "domain") return String(a.domain).localeCompare(String(b.domain)) * order;
          const at = a.last_synced ? Date.parse(a.last_synced) : 0;
          const bt = b.last_synced ? Date.parse(b.last_synced) : 0;
          return (at - bt) * order;
        });

      return json({
        articles: rows.slice(offset, offset + limit),
        total: rows.length,
        returned: Math.min(limit, Math.max(0, rows.length - offset)),
        offset,
        limit,
      });
    }
    case "/api/articles-domains":
      return json({ domains: DOMAIN_CARDS });
    case "/api/admin/domains":
      return json({ domains: CLASSIFIER_DOMAINS });
    case "/api/sync-status":
      return json(SYNC_STATUS);
    case "/api/articles-recent":
      return json({ articles: [] });
    default:
      return json({ articles: [], domains: [], messages: [], items: [] });
  }
}) as typeof window.fetch;

/** The page reads `role`/`perms` from props, not from a session, so no auth is needed. */
createRoot(document.getElementById("root")!).render(
  <KnowledgePage
    role="admin"
    userName="aung.lae"
    perms={{ manage_domains: true, manage_knowledge: true }}
    onToast={(msg) => { void msg; }}  // harness: no console output in a shipped bundle
  />,
);

window.__KB_HARNESS__ = { scenario, ready: true, calls };
void realFetch;
