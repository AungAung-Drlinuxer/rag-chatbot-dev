/**
 * Render harness for the Audit log — screenshots and MEASURES it WITHOUT signing in.
 *
 * WHY A HARNESS
 * The audit page is admin-only and a verification script must not sign in as anyone.
 * This renders the real `AuditsPage` component on the real stylesheet, with `fetch`
 * stubbed to return a fixture whose SHAPE is copied field-for-field from
 * `admin_list_audits` in `backend/app/api/admin_ops.py`
 * (audits[{id,action,username,domain,confidence,decision,detail,created_at}], total,
 * actions). Nothing about the component is mocked — only its data source is.
 *
 * The fixture deliberately carries MORE rows than one page (23) so pagination, the
 * range footer and the result filter are all exercised, and it carries every decision
 * value the live table actually holds (answer, caution, NULL) so a filter option that
 * matches nothing would be visible rather than silently empty.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/audits_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import AuditsPage from "./features/audits/pages/AuditsPage";

declare global {
  interface Window {
    __AUD_REQS__: string[];
    __AUD_HARNESS__?: { theme: string; rows: number; ready: boolean };
  }
}

const ACTIONS = [
  "chat", "chat", "chat", "sync", "login", "chat", "chat", "chat",
  "chat", "chat", "chat", "chat", "chat", "escalate", "feedback",
  "apikey.create", "domain_renamed", "rbac.matrix.update", "user.role.update",
  "guardrail.injection", "settings_update", "domain_blocked", "chat",
];

// A deterministic spread over the last two days so "Today's events" is a real count.
function ts(i: number): string {
  const d = new Date();
  d.setUTCMinutes(d.getUTCMinutes() - i * 47);
  return d.toISOString();
}

const ROWS = Array.from({ length: 23 }, (_, i) => {
  const action = ACTIONS[i % ACTIONS.length];
  const isChat = action === "chat";
  const decision = isChat ? (i % 3 === 0 ? "caution" : i % 3 === 1 ? "answer" : null) : null;
  return {
    id: 9000 - i,
    action,
    username: i % 7 === 3 ? null : ["ith@dmin", "aung.lae", "kyaw.zin", "su.myat"][i % 4],
    domain: isChat
      ? ["general", "database", "security", "software_dev", "storage", "general", "network"][i % 7]
      : null,
    confidence: isChat ? Math.round((0.62 + ((i % 9) * 0.04)) * 100) / 100 : null,
    decision,
    detail: action === "sync" ? "kb_sync" : i % 5 === 0 ? `detail line ${i} — a longer audit detail that must truncate rather than wrap the row` : null,
    created_at: ts(i),
  };
});

const ROUTES: Record<string, (url: URL) => unknown> = {
  "/api/admin/audits": (url) => {
    const action = url.searchParams.get("action");
    const rows = action ? ROWS.filter((r) => r.action === action) : ROWS;
    return { audits: rows, total: 2709, actions: [...new Set(ROWS.map((r) => r.action))].sort() };
  },
};

window.__AUD_REQS__ = [];
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  window.__AUD_REQS__.push(url);
  const parsed = new URL(url, window.location.origin);
  const make = ROUTES[parsed.pathname];
  if (!make) return realFetch(input as RequestInfo, init);
  return new Response(JSON.stringify(make(parsed)), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "light" ? "light" : "dark";
document.documentElement.dataset.theme = theme;

createRoot(document.getElementById("root")!).render(<AuditsPage />);

window.__AUD_HARNESS__ = { theme, rows: ROWS.length, ready: true };
