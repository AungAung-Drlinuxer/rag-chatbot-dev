/**
 * Render harness for the shell-level top bar — mounts the REAL <App /> with `fetch` stubbed.
 *
 * WHY A HARNESS
 * The app is behind auth and a verification script must not sign in as anyone. Every other
 * harness in this repo renders a single page component; the top bar is SHELL-level, so it
 * cannot be seen that way. This one instead boots the real App — the same component the
 * desktop ships — and restores a session the same way App restores it (loadTokens() reads
 * sessionStorage in a browser; there is no Tauri keyring here). The hash router then selects
 * the page, exactly as it does in production.
 *
 * NOTHING IS MOCKED EXCEPT THE DATA SOURCE. The only stubs are `fetch` responses whose shapes
 * match the endpoints. The health fixture is the shape /api/dashboard/health returns
 * (`{services, overall, down, security}`) with SEVEN dependencies, all healthy — so the pill
 * must read "7 dependencies healthy in source".
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/topbar_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import App from "./App";

declare global {
  interface Window {
    __TOPBAR_REQS__: string[];
    __TOPBAR_HARNESS__?: { ready: boolean };
  }
}

// A signed-in session, restored exactly the way App restores it. The JWT only needs a `sub`
// claim — usernameFromToken() decodes it for display and never verifies it.
const payload = btoa(JSON.stringify({ sub: "aung.lae" }));
sessionStorage.setItem("tokens", JSON.stringify({ access: `h.${payload}.s`, refresh: "" }));

/** Seven healthy dependencies → the pill must read "7 dependencies healthy in source". */
const HEALTH = {
  overall: "Healthy",
  down: [],
  services: [
    { key: "postgres", name: "PostgreSQL", status: "Healthy", latency_ms: 4 },
    { key: "redis", name: "Redis", status: "Healthy", latency_ms: 1 },
    { key: "neo4j", name: "Neo4j", status: "Healthy", latency_ms: 9 },
    { key: "ollama", name: "Ollama", status: "Healthy", latency_ms: 12 },
    { key: "rerank", name: "Rerank service", status: "Healthy", latency_ms: 38 },
    { key: "llm", name: "LLM gateway", status: "Healthy", latency_ms: 210 },
    { key: "jira", name: "Jira", status: "Healthy", latency_ms: 55 },
  ],
  security: { guardrail_events_7d: 0 },
};

const theme = new URLSearchParams(location.search).get("theme") || "light";

// Path-keyed fixtures for the endpoints App itself calls on boot; every other endpoint gets a
// neutral empty payload so an unrelated call cannot make a page look broken.
const ROUTES: Record<string, unknown> = {
  "/api/auth/me": { username: "aung.lae", role: "admin", displayRole: "Administrator", permissions: {} },
  "/api/settings": { theme, density: "comfortable", chat_font_size: 14 },
  "/api/dashboard/health": HEALTH,
};

const EMPTY = {
  items: [], data: [], messages: [], users: [], tickets: [], conversations: [],
  domains: [], articles: [], approvals: [], notices: [], results: [], series: [],
};

window.__TOPBAR_REQS__ = [];
window.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  window.__TOPBAR_REQS__.push(url);
  const path = new URL(url, window.location.origin).pathname;
  const body = path in ROUTES ? ROUTES[path] : EMPTY;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(<App />);

window.__TOPBAR_HARNESS__ = { ready: true };
