/**
 * Render harness for the two pages that were split apart: Knowledge Base Articles
 * (features/knowledge) and Domains & Routing Engine (features/domains).
 *
 * WHY A HARNESS
 * Both pages sit behind auth, and a verification script must not sign in as anyone. This
 * renders the real page components on the real stylesheet with `fetch` stubbed to fixtures
 * whose shapes come from the endpoint returns. Nothing about the components is duplicated.
 *
 * It exists to answer two questions with arithmetic rather than by eye:
 *   1. is the tab bar really gone, and does each page now own its own header?
 *   2. are the card rows evenly filled and are the cards equal in height?
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/pages_split_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import KnowledgePage from "./features/knowledge/pages/KnowledgePage";
import DomainsPage from "./features/domains/pages/DomainsPage";

declare global {
  interface Window {
    __SPLIT_REQS__: string[];
    __SPLIT_HARNESS__?: { page: string; ready: boolean };
  }
}

const article = (i: number) => ({
  page_id: `kb-${1000 + i}`,
  title: [
    "Runbook — Restart the Print Spooler",
    "Server Disk Usage Above 85% — Free Space Runbook",
    "Database Connection Timeout — Troubleshooting Guide",
    "Reset AD Password",
    "VPN Gateway Disconnects — Troubleshooting",
    "Password Expired — Re-sync MFA and Unlock Account",
  ][i % 6],
  domain: ["system", "system", "database", "security", "network", "security"][i % 6],
  updated_at: "2026-10-28T04:15:00+00:00",
  excerpt: "Real seed article from backend/kb_files, used to shape the list rows.",
});

const DOMAINS = [
  {
    id: 1, domain_key: "database", display_name: "Database", description: "SQL, timeouts, migrations",
    keywords: ["postgres", "timeout", "deadlock", "index", "replication", "pgvector"], jira_project: "ITHD",
    jira_assignee: null, icon: "database", color: "#6366f1", custom_icon: null, is_active: true,
    created_at: "2026-01-04T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  },
  {
    id: 2, domain_key: "network", display_name: "Network", description: "VPN, DNS, firewall",
    keywords: ["vpn", "dns", "firewall", "latency", "gateway"], jira_project: "ITHD",
    jira_assignee: null, icon: "network", color: "#0ea5e9", custom_icon: null, is_active: true,
    created_at: "2026-01-04T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  },
  {
    id: 3, domain_key: "security", display_name: "Security", description: "AD, MFA, account locks",
    keywords: ["password", "ad", "mfa", "locked", "phishing", "certificate"], jira_project: "ITHD",
    jira_assignee: null, icon: "shield", color: "#ef4444", custom_icon: null, is_active: true,
    created_at: "2026-01-04T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  },
  {
    id: 4, domain_key: "system", display_name: "System", description: "Printers, disk, services",
    keywords: ["printer", "spooler", "disk", "service", "reboot"], jira_project: "ITHD",
    jira_assignee: null, icon: "server", color: "#f59e0b", custom_icon: null, is_active: true,
    created_at: "2026-01-04T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  },
  {
    id: 5, domain_key: "general", display_name: "General", description: "Everything else",
    keywords: ["help", "question"], jira_project: null, jira_assignee: null, icon: "help-circle",
    color: "#64748b", custom_icon: null, is_active: false,
    created_at: "2026-01-04T00:00:00Z", updated_at: "2026-10-20T00:00:00Z",
  },
];

const ROUTES: Record<string, (url: URL) => unknown> = {
  "/api/admin/domains": () => ({ domains: DOMAINS }),
  "/api/articles-domains": () => ({
    domains: [
      { domain: "database", pages: 41 },
      { domain: "network", pages: 33 },
      { domain: "security", pages: 58 },
      { domain: "system", pages: 74 },
      { domain: "general", pages: 23 },
    ],
  }),
  "/api/articles-list": () => ({ total: 229, articles: Array.from({ length: 8 }, (_, i) => article(i)) }),
  "/api/articles-recent": () => ({ articles: Array.from({ length: 4 }, (_, i) => article(i)) }),
  "/api/sync-status": () => ({
    healthy: true,
    last_run: { at: "2026-10-30T02:00:00+00:00", added: 3, updated: 1 },
    beat_interval_minutes: 30,
  }),
  "/api/articles/search": () => ({ total: 0, results: [] }),
};

window.__SPLIT_REQS__ = [];
// Every request is answered from the fixture table below; an unknown path returns `{}` so
// a page under test cannot fail merely because this harness does not model every endpoint.
window.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  window.__SPLIT_REQS__.push(url);
  const parsed = new URL(url, window.location.origin);
  const make = ROUTES[parsed.pathname];
  return new Response(JSON.stringify(make ? make(parsed) : {}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

const params = new URLSearchParams(location.search);
const page = params.get("page") === "articles" ? "articles" : "domains";
const role = params.get("role") === "user" ? "user" : "admin";

createRoot(document.getElementById("root")!).render(
  page === "articles" ? (
    <KnowledgePage role={role} userName="Aung Lae" onToast={() => {}} />
  ) : (
    <DomainsPage role={role} perms={{ manage_domains: true, manage_users: true }} />
  ),
);

window.__SPLIT_HARNESS__ = { page, ready: true };
