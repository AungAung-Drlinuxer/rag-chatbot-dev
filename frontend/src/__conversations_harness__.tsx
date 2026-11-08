/**
 * Render harness for Conversation history — screenshots and MEASURES it WITHOUT signing in.
 *
 * The page is admin-only, so this renders the real `ConversationHistoryPage` on the real
 * stylesheet with `fetch` stubbed to the shapes `admin_list_conversations` and
 * `admin_conversation_messages` return:
 *   GET /api/admin/conversations          -> { conversations: [{session_id, username, title, messages, last_at}] }
 *   GET /api/admin/conversations/:id/messages -> { username, messages: [{role, content, created_at}] }
 *   GET /api/users                        -> { users: [{username}] }   (the user filter)
 *
 * 23 conversations so paging and the search are exercised; the first row is opened so the
 * transcript pane renders with real-looking turns.
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import ConversationHistoryPage from "./features/conversations/pages/ConversationHistoryPage";

declare global {
  interface Window {
    __CONV_HARNESS__?: { theme: string; conversations: number; ready: boolean };
  }
}

const USERS = ["ith@dmin", "aung.lae", "kyaw.zin", "su.myat"];
const TITLES = [
  "VPN keeps dropping after the update",
  "How do I request a new laptop?",
  "Shared drive permissions for the finance team",
  "Outlook calendar not syncing on mobile",
  "Password reset for the print server",
  "Which Wi-Fi network should contractors use?",
];

function at(i: number): string {
  const d = new Date();
  d.setUTCMinutes(d.getUTCMinutes() - i * 97);
  return d.toISOString();
}

const CONVERSATIONS = Array.from({ length: 23 }, (_, i) => ({
  session_id: `sess-${String(1000 + i)}-${i % 5}`,
  username: USERS[i % USERS.length],
  title: TITLES[i % TITLES.length],
  messages: 4 + ((i * 3) % 9),
  last_at: at(i),
}));

const MESSAGES = [
  { role: "user", content: "My VPN drops every ten minutes after the client update this week.", created_at: at(1) },
  { role: "assistant", content: "That matches a known issue with the 5.2 client on Windows 11. Switch the tunnel protocol to IKEv2 in Settings → VPN → Advanced, then reconnect.", created_at: at(1) },
  { role: "user", content: "Will that break the split-tunnel policy we use for the finance apps?", created_at: at(0) },
  { role: "assistant", content: "No — the split-tunnel routes are server-side (see Network → VPN policy). Only the transport changes.", created_at: at(0) },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  if (url.includes("/api/admin/conversations/") && url.includes("/messages")) {
    return json({ username: CONVERSATIONS[0].username, messages: MESSAGES });
  }
  if (url.includes("/api/admin/conversations")) return json({ conversations: CONVERSATIONS });
  if (url.includes("/api/users")) return json({ users: USERS.map((username) => ({ username })) });
  if (url.includes("/api/auth/me")) {
    return json({ user: { id: 1, username: "ith@dmin", role: "admin", display_name: "Aung Lae" } });
  }
  if (url.includes("/api/branding")) return json({ product_name: "IT Help Chat", primary_color: null });
  return realFetch(input as RequestInfo, init);
};

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");

createRoot(document.getElementById("root")!).render(<ConversationHistoryPage />);
window.__CONV_HARNESS__ = { theme, conversations: CONVERSATIONS.length, ready: true };
