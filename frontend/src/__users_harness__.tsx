/**
 * Render harness for the Users (workspace members) page — screenshots and MEASURES
 * it WITHOUT signing in.
 *
 * WHY A HARNESS
 * The users directory is admin-only and a verification script must not sign in as
 * anyone. This renders the real `Users` component on the real stylesheet, with
 * `fetch` stubbed to a fixture whose SHAPE is copied field-for-field from
 * `list_users` in `backend/app/api/users.py`
 * (users[{id,name,username,email,department,role,roleOverride,status,groups,lastLogin,joined,source}])
 * plus `{ users: [...] }` and `/api/users/{u}/permissions`
 * ({username, effective, overrides} from admin_ops.get_user_permissions).
 * Nothing about the component is mocked — only its data source is.
 *
 * The fixture deliberately carries MORE members than one page (12) so the pager and
 * range footer are exercised, and it carries every state the live endpoint can
 * return — Active / Inactive / Locked / Disabled, source local / ad, a user with
 * `joined: "—"` and one that has never logged in — so a fabricated cell would be
 * visible rather than silently plausible.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/users_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import UsersPage from "./features/users/pages/UsersPage";

declare global {
  interface Window {
    __USR_REQS__: { method: string; path: string; body: string }[];
    __USR_FIXTURE__: { total: number; active: number; admins: number; inactive: number; locked: number };
    __USR_HARNESS__?: { theme: string; users: number; ready: boolean };
  }
}

const ISO = "2026-10-28T09:12:00Z";

/** Local users: `joined` is always "—" from the endpoint (users.py local block). */
const LOCAL = [
  { id: "local:alice", name: "alice", username: "alice", email: "alice@drlinuxer.com", department: "IT Operations", role: "Administrator", roleOverride: "admin", status: "Active", groups: ["admins"], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:carol", name: "carol", username: "carol", email: "carol@drlinuxer.com", department: "Internal", role: "User", roleOverride: "user", status: "Locked", groups: [], lastLogin: "—", joined: "—", source: "local" },
  { id: "local:dave", name: "dave", username: "dave", email: "dave@drlinuxer.com", department: "Finance", role: "Knowledge Manager", roleOverride: "knowledge", status: "Active", groups: ["kb-editors"], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:backup-svc", name: "backup-svc", username: "backup-svc", email: "backup-svc@drlinuxer.com", department: "Internal", role: "User", roleOverride: "user", status: "Active", groups: [], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:erin", name: "erin", username: "erin", email: "erin@drlinuxer.com", department: "IT Operations", role: "IT Support", roleOverride: "agent", status: "Inactive", groups: ["support"], lastLogin: "—", joined: "—", source: "local" },
  { id: "local:frank", name: "frank", username: "frank", email: "frank@drlinuxer.com", department: "Sales", role: "User", roleOverride: "user", status: "Disabled", groups: [], lastLogin: "—", joined: "—", source: "local" },
  { id: "local:grace", name: "grace", username: "grace", email: "grace@drlinuxer.com", department: "Sales", role: "User", roleOverride: "user", status: "Active", groups: [], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:henry", name: "henry", username: "henry", email: "henry@drlinuxer.com", department: "Finance", role: "User", roleOverride: "user", status: "Active", groups: [], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:ivy", name: "ivy", username: "ivy", email: "ivy@drlinuxer.com", department: "Internal", role: "User", roleOverride: "user", status: "Active", groups: [], lastLogin: ISO, joined: "—", source: "local" },
  { id: "local:jack", name: "jack", username: "jack", email: "jack@drlinuxer.com", department: "Sales", role: "User", roleOverride: "user", status: "Active", groups: [], lastLogin: ISO, joined: "—", source: "local" },
];

/** AD users: `joined` comes from whenCreated, role from AD groups / role_override. */
const AD = [
  { id: "ad:bob", name: "Bob Brown", username: "bob", email: "bob@drlinuxer.com", department: "Finance", role: "Agent", roleOverride: "agent", status: "Active", groups: ["IT Support", "VPN Users"], lastLogin: "—", joined: "2024-03-11T08:00:00Z", source: "ad" },
  { id: "ad:kate", name: "Kate Klein", username: "kate", email: "kate@drlinuxer.com", department: "IT Operations", role: "Administrator", roleOverride: null, status: "Active", groups: ["Domain Admins"], lastLogin: ISO, joined: "2023-01-04T08:00:00Z", source: "ad" },
];

const USERS = [...LOCAL, ...AD];

/** Role → capability defaults, same matrix the page previews. */
const DEFAULTS: Record<string, Record<string, boolean>> = {
  Administrator: { chatbot: true, kb_search: true, create_tickets: true, manage_kb: true, manage_users: true, manage_domains: true },
  "Knowledge Manager": { chatbot: true, kb_search: true, create_tickets: false, manage_kb: true, manage_users: false, manage_domains: true },
  "IT Support": { chatbot: true, kb_search: true, create_tickets: true, manage_kb: false, manage_users: false, manage_domains: false },
  User: { chatbot: true, kb_search: true, create_tickets: false, manage_kb: false, manage_users: false, manage_domains: false },
};

/** Canonical role for a fixture row (mirrors the page's normaliser). */
function canonical(role: string): string {
  const key = role.trim().toLowerCase();
  return ({ agent: "IT Support", admin: "Administrator", administrator: "Administrator", knowledge: "Knowledge Manager", "knowledge manager": "Knowledge Manager", "it support": "IT Support", user: "User" } as Record<string, string>)[key] ?? "User";
}

const effectiveFor = (username: string) => {
  const u = USERS.find((x) => x.username === username);
  return DEFAULTS[canonical(u?.role ?? "User")];
};

window.__USR_REQS__ = [];
window.__USR_FIXTURE__ = {
  total: USERS.length,
  active: USERS.filter((u) => u.status === "Active").length,
  admins: USERS.filter((u) => canonical(u.role) === "Administrator").length,
  inactive: USERS.filter((u) => u.status !== "Active").length,
  locked: USERS.filter((u) => u.status === "Locked").length,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  const parsed = new URL(url, window.location.origin);
  const path = parsed.pathname;
  const body = typeof init?.body === "string" ? init.body : "";

  // Only /api/* is stubbed; anything else (favicon, assets) goes to the real fetch.
  if (!path.startsWith("/api/")) return realFetch(input as RequestInfo, init);

  window.__USR_REQS__.push({ method, path, body });

  if (method === "GET" && path === "/api/users") {
    // The endpoint sorts by username (users.py: sorted(..., key=username.lower())).
    return json({ users: [...USERS].sort((a, b) => a.username.localeCompare(b.username)) });
  }
  const perm = path.match(/^\/api\/users\/([^/]+)\/permissions$/);
  if (method === "GET" && perm) {
    const username = decodeURIComponent(perm[1]);
    return json({ username, effective: effectiveFor(username), overrides: {} });
  }
  const role = path.match(/^\/api\/users\/([^/]+)\/role$/);
  if (method === "PATCH" && role) return json({ ok: true, username: decodeURIComponent(role[1]), role_override: "user" });
  const status = path.match(/^\/api\/users\/([^/]+)\/status$/);
  if (method === "PATCH" && status) {
    const enabled = /"enabled"\s*:\s*true/.test(body);
    return json({ ok: true, username: decodeURIComponent(status[1]), status: enabled ? "Active" : "Disabled" });
  }
  const reset = path.match(/^\/api\/users\/([^/]+)\/reset-access$/);
  if (method === "POST" && reset) return json({ ok: true, username: decodeURIComponent(reset[1]), status: "Active" });
  const password = path.match(/^\/api\/users\/([^/]+)\/password$/);
  if (method === "PUT" && password) return json({ ok: true, username: decodeURIComponent(password[1]) });

  return json({ detail: `harness has no route for ${method} ${path}` }, 404);
}) as typeof window.fetch;

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("root")!).render(<UsersPage />);

window.__USR_HARNESS__ = { theme, users: USERS.length, ready: true };
