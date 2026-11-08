/**
 * Settings page render harness — a tour of every section.
 *
 * The Settings page is admin-only and sits behind auth, so it cannot be photographed by
 * signing in. This renders the REAL `SettingsPage` (nothing about it is duplicated) with
 * `fetch` stubbed to empty-but-well-shaped payloads, and exposes a helper to select each
 * nav section so the shot script can capture one image per section.
 *
 * Payloads carry empty arrays rather than bare `{}` because the sections map over lists;
 * a missing key would render an error boundary instead of the section. Extra keys are
 * harmless, so each stub returns the union of the list names the sections may read.
 */
import "./styles.css";

import { createRoot } from "react-dom/client";
import Settings from "@/features/settings/pages/SettingsPage";

const reqs: string[] = [];
(window as any).__SETTINGS_PAGE_REQS__ = reqs;

/** Empty but shape-safe: every plausible list key is present as an empty array. */
const EMPTY = {
  settings: {}, values: {}, items: [], data: [], list: [], rows: [], domains: [],
  services: [], models: [], connectors: [], groups: [], extras: [], results: [],
  fields_set: [], secret_fields: [], alerts: {}, updated_at: null,
  counts: { total: 0, connected: 0, reachable: 0 },
};

window.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  reqs.push(`${init?.method ?? "GET"} ${url}`);

  let body: any = { ...EMPTY };
  if (/\/api\/settings$/.test(url) && !/integrations|smtp/.test(url)) {
    // Realistic prefs including the per-user integration opt-in map.
    body = {
      settings: {
        theme: "light", density: "comfortable", chat_font_size: 14,
        show_rag_sources: true, show_token_usage: true, markdown_rendering: true,
        animations: true, compact: false,
        integration_toggles: { confluence: true, jira: true, notion: true },
      },
      username: "aung",
    };
  } else if (/\/api\/settings\/integrations\/(confluence|jira)$/.test(url)) {
    body = {
      ...EMPTY,
      configured: true,
      fields_set: ["base_url", "email", "api_token", "space_keys"],
      secret_fields: ["api_token"],
      token_set: true,
      updated_at: "2026-10-31T05:00:00Z",
    };
  } else if (/\/api\/dashboard\/health/.test(url)) {
    body = [
      { name: "PostgreSQL", status: "healthy" },
      { name: "Redis", status: "healthy" },
      { name: "Ollama", status: "healthy" },
      { name: "Backend", status: "healthy" },
    ];
  } else if (/\/api\/settings\/integrations\/llm\/models/.test(url)) {
    body = {
      models: [
        { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
        { id: "cline-pass/kimi-k3.1-pro", name: "Kimi K3.1 Pro" },
        { id: "cline-pass/qwen3.8-flash", name: "Qwen 3.8 Flash" },
        { id: "cline-pass/glm-5-air", name: "GLM 5 Air" },
      ],
      count: 4,
      source: "clinepass",
    };
  } else if (/\/api\/settings\/integrations\/llm$/.test(url)) {
    body = {
      ...EMPTY,
      settings: { provider: "clinepass", model: "cline-pass/deepseek-v4.1-flash" },
      fields_set: ["provider", "base_url", "api_key", "model"],
      secret_fields: ["api_key"],
      token_set: true,
      updated_at: "2026-10-31T05:00:00Z",
    };
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

// `?role=user` renders the member view (no Integrations tab, personal opt-in card).
const HARNESS_ROLE = new URLSearchParams(location.search).get("role") === "user" ? "user" : "admin";
createRoot(document.getElementById("root")!).render(<Settings role={HARNESS_ROLE} />);

(window as any).__SETTINGS_PAGE__ = {
  /** Nav entries exactly as the sidebar renders them. */
  nav(): string[] {
    return [...document.querySelectorAll("aside button, nav button")]
      .map((b) => (b.textContent ?? "").trim())
      .filter((s) => s.length > 0 && s.length < 40);
  },

  /** Click a section by its visible label. */
  select(label: string): boolean {
    const btn = [...document.querySelectorAll("aside button, nav button")].find(
      (b) => (b.textContent ?? "").trim() === label,
    ) as HTMLElement | undefined;
    if (!btn) return false;
    btn.click();
    return true;
  },

  /** What the main panel is showing: headings, card titles and a text preview. */
  panel(): Record<string, unknown> {
    const main = document.querySelector("main") ?? document.body;
    const text = (main.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      headings: [...main.querySelectorAll("h1,h2,h3")].map((h) => (h.textContent ?? "").trim()),
      buttons: [...main.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter(Boolean).slice(0, 24),
      inputs: [...main.querySelectorAll("input,select,textarea")].length,
      text: text.slice(0, 4000),
    };
  },

  /** Geometry of the active section's top-level blocks. Used to prove the cards actually
   *  line up instead of trusting that they look aligned. */
  blocks(): { cls: string; width: number; left: number; right: number; height: number }[] {
    const main = document.querySelector("main") ?? document.body;
    // The section container is the last direct child of the scroll area.
    const containers = [...main.querySelectorAll("div.space-y-4")];
    const root = containers[containers.length - 1];
    if (!root) return [];
    return [...root.children].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        cls: String(el.className || "").slice(0, 34),
        width: Math.round(r.width),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
      };
    });
  },

  /** Resolved design tokens, plus PROOF that the utility classes actually picked up the
   *  overridden scale. Reading `--border` only proves the variable was set; probing
   *  `border-slate-800` proves the Tailwind theme override reached the generated utility,
   *  which is the part that can silently fail. */
  tokens(): Record<string, string> {
    const root = getComputedStyle(document.documentElement);
    const probe = (cls: string, prop: string) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const v = (getComputedStyle(el) as any)[prop] as string;
      el.remove();
      return v;
    };
    return {
      background: root.getPropertyValue("--background").trim(),
      foreground: root.getPropertyValue("--foreground").trim(),
      mutedForeground: root.getPropertyValue("--muted-foreground").trim(),
      card: root.getPropertyValue("--card").trim(),
      border: root.getPropertyValue("--border").trim(),
      primary: root.getPropertyValue("--primary").trim(),
      radiusLgVar: root.getPropertyValue("--radius-lg").trim(),
      radiusXlVar: root.getPropertyValue("--radius-xl").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      // utility-class resolution — the part that proves the override landed
      slate400Text: probe("text-slate-400", "color"),
      slate500Text: probe("text-slate-500", "color"),
      slate800Border: probe("border border-slate-800", "borderTopColor"),
      slate900Bg: probe("bg-slate-900", "backgroundColor"),
      slate200Border: probe("border border-slate-200", "borderTopColor"),
      roundedLg: probe("rounded-lg", "borderTopLeftRadius"),
      roundedXl: probe("rounded-xl", "borderTopLeftRadius"),
      roundedSm: probe("rounded-sm", "borderTopLeftRadius"),
    };
  },

  overflow(): { scrollW: number; clientW: number } {
    return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  },
};
