/**
 * Render harness for the Domains & Routing page — screenshots + measurements WITHOUT
 * logging in. It renders the real page component on the real stylesheet with `fetch`
 * stubbed to the `/api/admin/domains` shape the backend returns.
 *
 * The fixture deliberately covers every branch the list has to render honestly:
 * active/inactive, a domain with no Jira route, one with no keywords, one with a long
 * keyword list, and one with no description. Nothing here ships in the bundle.
 */
import "./styles.css";

import { createRoot } from "react-dom/client";
import DomainsPage from "./features/domains/pages/DomainsPage";

const now = new Date().toISOString();

const DOMAINS = [
  {
    id: 1, domain_key: "database", display_name: "Database", icon: "Database", color: "blue",
    description: "PostgreSQL, Oracle, deadlocks, pooling and slow query troubleshooting.",
    keywords: ["postgres", "postgresql", "deadlock", "connection refused", "slow query", "index", "vacuum", "replication", "pgbouncer"],
    jira_project: "DBOPS", jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 2, domain_key: "network", display_name: "Network", icon: "Network", color: "emerald",
    description: "VPN, DNS, firewall and office connectivity procedures.",
    keywords: ["vpn", "dns", "firewall", "latency", "packet loss"],
    jira_project: "NETOPS", jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 3, domain_key: "security", display_name: "Identity & Security", icon: "Lock", color: "rose",
    description: "Active Directory, MFA, password resets and access reviews.",
    keywords: ["password", "mfa", "active directory", "account locked", "sso"],
    jira_project: "SEC", jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 4, domain_key: "system", display_name: "System & Endpoint", icon: "Monitor", color: "amber",
    description: "",
    keywords: ["disk full", "printer", "spooler", "slow laptop", "windows update"],
    jira_project: null, jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 5, domain_key: "kubernetes", display_name: "Kubernetes", icon: "Cloud", color: "violet",
    description: "Cluster operations, deployments, and read-only diagnostics.",
    keywords: [],
    jira_project: "K8S", jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 6, domain_key: "general", display_name: "General IT", icon: "BookOpen", color: "slate",
    description: "Everything the classifier could not place in a specialist domain.",
    keywords: ["help", "it", "support", "laptop"],
    jira_project: "ITHD", jira_assignee: null, is_active: true, custom_icon: null,
    created_at: now, updated_at: now,
  },
  {
    id: 7, domain_key: "legacy_hr", display_name: "HR (retired)", icon: "BookOpen", color: "slate",
    description: "Retired HR routing — kept for historical articles only.",
    keywords: ["payroll", "leave"],
    jira_project: null, jira_assignee: null, is_active: false, custom_icon: null,
    created_at: now, updated_at: now,
  },
];

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  // Mutations are recorded instead of sent, so the form harness can assert the payload.
  const sent = (window as any).__sent ?? ((window as any).__sent = []);
  if (path.startsWith("/api/admin/domains") && init?.method && init.method !== "GET") {
    sent.push({ method: init.method, path, body: init.body ? JSON.parse(String(init.body)) : null });
    return json({ status: "ok", id: 99, domain_key: "probe", kb_pages_migrated: 3 });
  }

  if (path === "/api/admin/domains") {
    if (new URLSearchParams(location.search).get("scenario") === "error") {
      return json({ detail: "domains service unavailable" }, 503);
    }
    return json({ domains: DOMAINS });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

const perms = { manage_domains: true, manage_knowledge: true };
createRoot(document.getElementById("root")!).render(
  <DomainsPage role="admin" perms={perms} />,
);
