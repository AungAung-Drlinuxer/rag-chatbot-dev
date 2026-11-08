/**
 * Chat layout harness — renders the REAL ChatPage so the conversation column, the answer
 * container and the composer can be measured as rendered, not as read from the source.
 *
 * Nothing about ChatPage is duplicated: only its data source (fetch) is stubbed. The
 * fixture shapes are copied field-for-field from `features/conversations/api.ts` and from
 * ChatPage's own `openConversation` mapper, so the page takes the same code path it takes
 * against the real backend.
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import ChatPage from "@/features/chat/pages/ChatPage";
import RagPipelineStatus from "@/features/chat/components/RagPipelineStatus";

/* ------------------------------------------------------------------ fixtures ---- */

const SESSION = "harness-conv-0001";

const ANSWER_MD = [
  "Your VPN password is managed by the **corporate identity provider**, not by the VPN client itself.",
  "",
  "1. Open `https://id.drlinuxer.com` and sign in with your domain account.",
  "2. Choose **Security → Password**, then set a new one.",
  "3. Wait about two minutes for the change to replicate, then reconnect.",
  "",
  "```bash",
  "openconnect --protocol=anyconnect vpn.drlinuxer.com",
  "```",
].join("\n");

const CONV_MESSAGES = [
  { role: "user", content: "How do I reset my VPN password?", message_id: "u-1" },
  {
    role: "assistant",
    message_id: "a-1",
    content: ANSWER_MD,
    meta: {
      confidence: 0.86,
      decision: "answer",
      top_k: 5,
      latency_ms: 4210,
      usage: { input_tokens: 1840, output_tokens: 210, total_tokens: 2050 },
      retrieval: { chunks: 8, cited: 3, top_k: 5, rerank_used: true, acl_scoped: true, role: "user" },
      rag_trace: { stages: { understanding: 180, rewrite: 260, retrieve: 410, rerank: 300, generate: 3060 }, totalMs: 4210 },
      hits: [
        { page_id: "kb-101", title: "VPN client setup (AnyConnect)", domain: "Network", relevance: 0.91, content: "Install the AnyConnect client, then connect to vpn.drlinuxer.com with your domain account." },
        { page_id: "kb-102", title: "Password reset — identity provider", domain: "Identity", relevance: 0.88, content: "Passwords are changed at id.drlinuxer.com under Security → Password." },
        { page_id: "kb-103", title: "VPN troubleshooting checklist", domain: "Network", relevance: 0.74, content: "If the tunnel drops, check the certificate expiry and your MFA device clock." },
      ],
    },
  },
];

/* ------------------------------------------------------------------ fetch stub -- */

const REQS: string[] = [];
(window as any).__CHAT_REQS__ = REQS;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, _init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  REQS.push(url);

  // Anything the harness does not model returns an empty object rather than 404: the page
  // tolerates a missing list, but a thrown fetch would blank the whole surface and make
  // every measurement meaningless.

  // The chat header's four status chips read GET /api/dashboard/health. Without a stub
  // that call fails and every chip degrades to "—" — honest behaviour, but a useless
  // screenshot for reviewing the chips. Answered here in the real response shape:
  // a live dependency probe returning {services, overall, down}.
  if (/\/api\/dashboard\/health/.test(url)) {
    return json({
      overall: "Healthy",
      down: [],
      security: { guardrail_events_7d: 0 },
      services: [
        { key: "postgres", name: "PostgreSQL", status: "Healthy", latency_ms: 3, detail: "SELECT 1" },
        { key: "redis", name: "Redis", status: "Healthy", latency_ms: 1, detail: "PING" },
        { key: "ollama", name: "Embeddings", status: "Healthy", latency_ms: 41, detail: "bge-m3" },
        { key: "llm", name: "Model provider", status: "Healthy", latency_ms: 210, detail: "claude-sonnet" },
      ],
    });
  }

  if (/\/api\/conversations\/[^/]+\/messages/.test(url)) {
    return json({ session_id: SESSION, messages: CONV_MESSAGES });
  }
  if (/\/api\/conversations(\?|$)/.test(url)) {
    return json({
      conversations: [{ session_id: SESSION, title: "How do I reset my VPN password?", last_at: new Date().toISOString(), messages: 2 }],
    });
  }
  if (/\/api\/settings\/me|\/api\/settings(\?|$)/.test(url)) {
    return json({});
  }
  if (/\/api\/tickets\/destinations|\/api\/tickets\/domains|\/api\/users\/assignable/.test(url)) {
    return json({ destinations: [], domains: [], users: [] });
  }
  return json({});
};

/* ------------------------------------------------------------------ helpers ----- */

const rect = (el: Element | null) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
};

const byClass = (needle: string) => document.querySelector(`[class*="${needle}"]`);

function boxOf(el: Element | null) {
  if (!el) return null;
  const cs = getComputedStyle(el);
  return {
    ...rect(el),
    fontSize: cs.fontSize,
    lineHeight: cs.lineHeight,
    background: cs.backgroundColor,
    borderWidth: cs.borderTopWidth,
    borderRadius: cs.borderTopLeftRadius,
    shadow: cs.boxShadow === "none" ? "none" : "set",
  };
}

(window as any).__CHAT_HARNESS__ = {
  ready: false,

  /**
   * Open the seeded conversation so the message list renders.
   *
   * The conversation LIST is no longer part of ChatPage — it lives in the app shell's
   * sidebar, which opens a conversation by dispatching `ith:open-conversation` (ChatPage
   * subscribes to it). Looking for a clickable node inside this harness therefore found
   * nothing and every measurement was skipped, so the event is what to drive here. The
   * click stays as a fallback for a page that renders its own list.
   */
  async openConversation(): Promise<boolean> {
    const settled = async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (document.body.textContent?.includes("corporate identity provider")) return true;
      }
      return false;
    };
    window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: SESSION }));
    if (await settled()) return true;

    const wanted = "How do I reset my VPN password?";
    const nodes = Array.from(document.querySelectorAll("button, [role='button'], li, a, div"));
    const hit = nodes.find((n) => (n.textContent || "").includes(wanted) && n.children.length <= 3);
    if (!hit) return false;
    (hit as HTMLElement).click();
    return settled();
  },

  /** The three surfaces the review is about, measured as rendered. */
  measure() {
    const column = byClass("max-w-[900px]");
    const composer = document.querySelector("form")?.closest("div");
    // The answer BODY, not merely the first node sharing its type scale: the user
    // bubble also carries `text-[13.5px]`, so a bare byClass() returned the BUBBLE and
    // every "the answer is plain prose / wider than the bubble" assertion was measured
    // against the bubble itself — which is why both widths read 258px.
    const answer = document.querySelector('article [class*="text-[13.5px]"]');
    const userBubble = byClass("rounded-br-md");
    return {
      column: rect(column),
      columnFont: boxOf(column),
      composer: boxOf(composer as Element | null),
      answer: boxOf(answer),
      userBubble: boxOf(userBubble),
      answerText: (answer?.textContent || "").slice(0, 60),
      // how wide the answer text actually gets, which is the number the review cares about
      answerParagraph: boxOf(answer?.querySelector("p") ?? null),
    };
  },

  /** The in-flight pipeline, rendered for real with `active` set. */
  pipeline(active: boolean, defaultOpen: boolean) {
    const host = document.getElementById("pipeline-host");
    if (!host) return null;
    const root = createRoot(host);
    root.render(
      <RagPipelineStatus
        active={active}
        stage="Retrieving and reranking candidate passages"
        streaming={false}
        telemetry={{ understanding: 180, rewrite: 260, retrieve: 410, rerank: 300, generate: 3060 }}
        elapsedMs={4210}
        defaultOpen={defaultOpen}
      />,
    );
    return true;
  },

  pipelineBox() {
    const host = document.getElementById("pipeline-host");
    const first = host?.firstElementChild as Element | null;
    return first ? boxOf(first) : null;
  },

  bodyText: () => document.body.textContent || "",
  overflow: () => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }),
};

createRoot(document.getElementById("root")!).render(
  <>
    <ChatPage userName="Aung Lae" role="user" />
    {/* Second mount point for the pipeline, so its collapsed and expanded heights can be
        compared without needing a live SSE stream to drive it. */}
    <div id="pipeline-host" style={{ position: "fixed", left: "-9999px", top: 0, width: "900px" }} />
  </>,
);

// The page mounts synchronously; the fetch stub is already in place before it runs.
setTimeout(() => {
  (window as any).__CHAT_HARNESS__.ready = true;
}, 300);

// Keep a reference so the unused-import linter does not strip the fallback fetcher.
void realFetch;
