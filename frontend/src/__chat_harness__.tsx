/**
 * Render harness for the Chat page — real page, real MessageBubble, real SSE parser,
 * stubbed transport.
 *
 * `/api/chat/stream` is served as a genuine `text/event-stream` body so the page's own
 * streaming code path runs: meta → stage → token… → done. Nothing about the UI is faked;
 * only the server is.
 */
import "./styles.css";

import { createRoot } from "react-dom/client";
import ChatPage from "@/features/chat/pages/ChatPage";

const sse = (events: [string, unknown][]) =>
  events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

const HITS = [
  {
    page_id: "pg-1",
    title: "PostgreSQL — connection refused runbook",
    space: "Database",
    relevance: 0.91,
    excerpt: "Check max_connections, the listener address and the pooler saturation before restarting the service.",
    url: null,
  },
  {
    page_id: "pg-1",
    title: "PostgreSQL — connection refused runbook",
    space: "Database",
    relevance: 0.84,
    excerpt: "pg_isready reports accepting connections; if it fails, inspect postmaster.log for FATAL entries.",
    url: null,
  },
  {
    page_id: "pg-2",
    title: "Connection pooling with PgBouncer",
    space: "Database",
    relevance: 0.77,
    excerpt: "A full pool reports 'no more connections allowed' in the application log rather than at the database.",
    url: null,
  },
];

const ANSWER = [
  "Start with the **connection path**, not the database itself.\n\n",
  "1. Run `pg_isready -p 5432` on the database host.\n",
  "2. Compare `max_connections` with the number of active clients.\n",
  "3. Check PgBouncer saturation — a full pool looks like a refused connection to the app.\n\n",
  "If all three are healthy, read `postmaster.log` for `FATAL` entries before restarting anything.",
];

const realFetch = window.fetch.bind(window);
(window as any).__sent = [] as any[];

window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  if (path === "/api/domains") {
    return json({
      domains: [
        { key: "database", label: "Database" },
        { key: "network", label: "Network" },
        { key: "identity", label: "Identity" },
        { key: "kubernetes", label: "Kubernetes" },
      ],
    });
  }

  if (path === "/api/dashboard/health") {
    return json({
      services: [
        { key: "postgres", name: "PostgreSQL", status: "Healthy", latency_ms: 4 },
        { key: "redis", name: "Redis", status: "Healthy", latency_ms: 2 },
        { key: "ollama", name: "Ollama", status: "Degraded", latency_ms: 812 },
      ],
    });
  }

  if (path === "/api/chat/stream") {
    let asked = "";
    try {
      asked = String(JSON.parse(String(init?.body ?? "{}")).message ?? "");
    } catch {}
    if (/^(hi|hello|hey|hi there|good (morning|afternoon|evening))[!. ]*$/i.test(asked.trim())) {
      const smallTalk = "Hello! I'm your internal IT support assistant. How can I help you today?";
      const stChunks = [sse([["meta", {
        confidence: null,
        decision: "small_talk",
        hits: [],
        retrieval: { chunks: 0, cited: 0, top_k: 0, rerank_used: false, acl_scoped: false, role: "admin" },
        small_talk: "greeting",
      }]]), sse([["token", { token: smallTalk }]]), sse([["done", { latency_ms: 60, message_id: "srv-st-1" }]])];
      const stStream = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          for (const c of stChunks) { controller.enqueue(enc.encode(c)); await new Promise((r) => setTimeout(r, 20)); }
          controller.close();
        },
      });
      return new Response(stStream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }
    const chunks = [sse([["meta", {
      confidence: 0.88,
      decision: "answer",
      hits: HITS,
      usage: { input_tokens: 1240, output_tokens: 180, total_tokens: 1420 },
      retrieval: { chunks: 12, cited: 3, top_k: 8, rerank_used: true, acl_scoped: true, role: "admin" },
      tool_used: null,
    }]]),
      sse([["stage", { stage: "retrieve", detail: "Searching the knowledge base" }]]),
      ...ANSWER.map((t) => sse([["token", { token: t }]])),
      sse([["done", { latency_ms: 1420, message_id: "srv-msg-1", rag_trace: { stages: { retrieve: 320, generate: 1100 }, totalMs: 1420 } }]]),
    ];

    const stream = new ReadableStream({
      async start(controller) {
        const enc = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(enc.encode(chunk));
          await new Promise((r) => setTimeout(r, 45));
        }
        controller.close();
      },
    });

    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  if (path.includes("/messages")) return json({ messages: [] });
  if (path === "/api/feedback" || path.endsWith("/feedback")) {
    (window as any).__sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return json({ ok: true });
  }
  if (path === "/api/tickets") {
    (window as any).__sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
    return json({ id: "IT-900", subject: "escalation" });
  }

  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <ChatPage userName="ith@dmin" role="admin" onNavigate={() => {}} onLogout={() => {}} />,
);
