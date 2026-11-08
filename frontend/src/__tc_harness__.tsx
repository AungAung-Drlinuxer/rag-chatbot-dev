/**
 * Render harness for the Tickets page and the Conversation history page — screenshots and
 * MEASURES them WITHOUT signing in.
 *
 * WHY A HARNESS
 * Both pages are admin-only, and a verification script must not sign in as anyone. This
 * renders the real page components on the real stylesheet with `fetch` stubbed to fixtures
 * whose SHAPE is copied from the API modules the pages actually call
 * (features/tickets/api.ts, features/conversations/admin-api.ts, features/users/api.ts).
 * Nothing about the components is mocked — only their data source.
 *
 * The fixtures deliberately carry MORE rows than the mockups show, so a page that renders
 * one row, or that silently drops a column, is visible rather than plausible.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/tc_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import Tickets from "./features/tickets/pages/TicketsPage";
import ConversationHistoryPage from "./features/conversations/pages/ConversationHistoryPage";

declare global {
  interface Window {
    __TC_REQS__: string[];
    __TC_HARNESS__?: { page: string; theme: string; ready: boolean };
  }
}

const mins = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const USERS = [
  { username: "alice", email: "alice@example.com", role: "agent" },
  { username: "bob", email: "bob@example.com", role: "agent" },
  { username: "carol", email: "carol@example.com", role: "agent" },
  { username: "dave", email: "dave@example.com", role: "user" },
];

// Field-for-field the ticket shape the table and the detail panel read.
const TICKETS = [
  { id: "ITHD-42", subject: "VPN down for the finance team", status: "open", priority: "high",
    category: "Network", requester: "alice", assignee: "carol",
    description: "The finance team cannot reach the VPN gateway since 09:10.",
    created_at: mins(240), updated_at: mins(18) },
  { id: "ITHD-41", subject: "Printer jam on floor 3", status: "pending", priority: "medium",
    category: "Hardware", requester: "bob", assignee: null,
    description: "Paper jam reported twice this morning.", created_at: mins(300), updated_at: mins(45) },
  { id: "ITHD-40", subject: "Database is slow after the migration", status: "open", priority: "critical",
    category: "Database", requester: "dave", assignee: "alice",
    description: "Query latency tripled since the schema migration.", created_at: mins(420), updated_at: mins(70) },
  { id: "ITHD-39", subject: "Reset MFA for a new starter", status: "resolved", priority: "low",
    category: "Identity", requester: "carol", assignee: "alice",
    description: "MFA enrolment failed on the first device.", created_at: mins(600), updated_at: mins(120) },
  { id: "ITHD-38", subject: "Shared drive permissions review", status: "open", priority: "medium",
    category: "Identity", requester: "alice", assignee: null,
    description: "Quarterly review of the shared drive ACLs.", created_at: mins(900), updated_at: mins(200) },
];

// The conversation shape the table reads, plus the transcript the panel renders.
const CONVS = [
  { session_id: "s1", username: "ith@dmin", title: "Reset my password and re-sync my MFA token?",
    messages: 6, started_at: mins(1500), last_at: mins(1490) },
  { session_id: "s2", username: "AungAung", title: "Database is down",
    messages: 4, started_at: mins(1600), last_at: mins(1590) },
  { session_id: "s3", username: "alice", title: "VPN client setup (AnyConnect)",
    messages: 8, started_at: mins(1800), last_at: mins(1780) },
];

const MESSAGES = [
  { role: "user", content: "How do I reset my password?", created_at: mins(1500) },
  { role: "assistant", content: "Your VPN password is managed by the corporate identity provider.", created_at: mins(1498) },
  { role: "user", content: "And the MFA token?", created_at: mins(1494) },
  { role: "assistant", content: "Re-enrol it from id.example.com with your domain account.", created_at: mins(1491) },
];

// Route table: pathname -> payload. Unknown paths return an empty payload rather than
// falling through to the network, so a render is deterministic and never touches the real API.
const ROUTES: Record<string, () => unknown> = {
  "/api/tickets": () => ({ tickets: TICKETS, total: TICKETS.length }),
  "/api/ticket-destinations": () => ({
    destinations: [
      { key: "jira", label: "Jira", configured: true },
      { key: "openproject", label: "OpenProject", configured: false },
    ],
  }),
  "/api/domains": () => [
    { key: "network", label: "Network" },
    { key: "database", label: "Database" },
  ],
  "/api/users": () => ({ users: USERS }),
  "/api/users/assignable": () => ({ users: USERS }),
  "/api/admin/conversations": () => ({ conversations: CONVS }),
  "/api/tickets/ITHD-42/comments": () => ({ comments: [] }),
  "/api/tickets/ITHD-42/attachments": () => ({ attachments: [] }),
};

window.__TC_REQS__ = [];
window.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  window.__TC_REQS__.push(url);
  const parsed = new URL(url, window.location.origin);
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const transcript = /^\/api\/admin\/conversations\/([^/]+)\/messages$/.exec(parsed.pathname);
  if (transcript) return json({ username: "ith@dmin", messages: MESSAGES });
  if (/\/export$/.test(parsed.pathname)) return new Response("transcript", { status: 200 });
  if (/draft/.test(parsed.pathname)) return json({ draft: "Suggested description" });
  const make = ROUTES[parsed.pathname];
  if (!make) return json({});
  return json(make());
}) as typeof window.fetch;

const params = new URLSearchParams(window.location.search);
const page = params.get("page") ?? "tickets";
const theme = params.get("theme") ?? "dark";
document.documentElement.setAttribute("data-theme", theme);
if (theme === "dark") document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  page === "tickets" ? (
    <Tickets role="admin" userName="Aung Lae" onToast={() => {}} />
  ) : (
    <ConversationHistoryPage />
  ),
);

window.__TC_HARNESS__ = { page, theme, ready: true };
