/**
 * The panel vocabulary of the Overview page.
 *
 * A panel is DATA, not code: `{id, type, title, span, options}` is what gets saved in
 * `dashboard_layouts`, and this file is the only place that maps a `type` to something
 * renderable. Adding a panel type therefore means adding a catalogue entry plus a body — no
 * migration, and a layout saved before the type existed keeps working.
 */
export type PanelType =
  | "attention"
  | "kpis"
  | "trend"
  | "quality"
  | "domains"
  | "knowledge"
  | "health"
  | "note"
  | "usage-kpis"
  | "cost-trend"
  | "model-cost"
  | "outcome-mix"
  | "guardrail-events"
  | "token-breakdown";

export type PanelSpec = {
  id: string;
  type: PanelType;
  title: string;
  /** Width in a 12-column grid. 12 = full width, 6 = half, 4 = third. */
  span: number;
  /** Height in grid rows. Absent = the type's natural height. */
  h?: number;
  options: {
    /** Recent-list panels: how many rows to show. */
    limit?: number;
    /** Note panel: the text. Plain text, newlines preserved. */
    body?: string;
  };
};

export type PanelCatalogueEntry = {
  type: PanelType;
  label: string;
  description: string;
  defaultSpan: number;
  /** Panels that render nothing useful twice (e.g. the KPI row) are marked so the
   *  catalogue can explain duplicates instead of silently allowing them. */
  repeatable?: boolean;
};

export const MAX_SPAN = 12;

/** One grid row, in pixels, including the gap between rows. */
export const ROW_H = 92;
const GAP = 8;

/** The height a panel type wants, in rows. Charts need room; a KPI strip does not. */
export const PANEL_HEIGHTS: Partial<Record<PanelType, number>> = {
  attention: 2,
  "usage-kpis": 2,
  kpis: 3,
  trend: 5,
  quality: 5,
  "outcome-mix": 5,
  "cost-trend": 5,
  "token-breakdown": 5,
  "model-cost": 4,
  domains: 4,
  knowledge: 4,
  health: 4,
  "guardrail-events": 4,
  note: 3,
};

export function panelHeight(panel: PanelSpec): number {
  const rows = panel.h ?? PANEL_HEIGHTS[panel.type] ?? 4;
  return rows * ROW_H - GAP;
}

export function panelTitle(panel: PanelSpec): string {
  if (panel.title) return panel.title;
  const entry = PANEL_CATALOGUE.find((e) => e.type === panel.type);
  return entry?.label ?? "Panel";
}

export function catalogueFor(type: PanelType): PanelCatalogueEntry | undefined {
  return PANEL_CATALOGUE.find((e) => e.type === type);
}

export const PANEL_CATALOGUE: PanelCatalogueEntry[] = [
  { type: "attention", label: "Needs attention", defaultSpan: 12,
    description: "Failing dependencies, low-confidence answers and guardrail signals." },
  { type: "kpis", label: "Volume KPI tiles", defaultSpan: 12,
    description: "Conversations, resolved by bot, escalations and active users." },
  { type: "trend", label: "Conversations over time", defaultSpan: 8,
    description: "Daily volume split by outcome, for the selected reporting window." },
  { type: "quality", label: "Answer quality", defaultSpan: 4,
    description: "Resolved / escalated split plus the confidence-gate pass rate." },
  { type: "domains", label: "Knowledge by domain", defaultSpan: 6,
    description: "How the indexed knowledge base is distributed across domains." },
  { type: "knowledge", label: "Workspace", defaultSpan: 6,
    description: "Indexed articles and blocked attacks (admin)." },
  { type: "health", label: "System health", defaultSpan: 6,
    description: "Every dependency with latency, plus guardrail activity." },
  { type: "note", label: "Text note", defaultSpan: 6,
    description: "Your own note — runbook link, rotation reminder, anything.", repeatable: true },
  // --- merged from the former Observability page ------------------------------------
  { type: "usage-kpis", label: "Tokens, cost & latency", defaultSpan: 12,
    description: "Answers, tokens in/out, estimated spend and p95 latency for the window." },
  { type: "cost-trend", label: "Tokens & cost per day", defaultSpan: 6,
    description: "Daily token volume and estimated spend, same window as the report selector." },
  { type: "model-cost", label: "Cost by model", defaultSpan: 6,
    description: "Which model took the spend (and how many requests each answered)." },
  { type: "outcome-mix", label: "Outcome mix", defaultSpan: 4,
    description: "How answers ended — answer, caution, escalate — with the confidence-gate pass rate." },
  { type: "guardrail-events", label: "Guardrail events", defaultSpan: 6,
    description: "Newest refusals from the audit trail (administrators only)." },
  { type: "token-breakdown", label: "Tokens by model", defaultSpan: 6,
    description: "Answers, tokens in/out and spend per model — the detail behind the total." },
];

/**
 * Two defaults, because the same board serves two jobs: an operator opening the page in the
 * morning needs the queue and the health strip; the same operator at month end needs tokens
 * and spend. Cost is administrator-only (the API refuses it for everyone else), so the tiles
 * are in the admin default and absent from the user default rather than rendering locked.
 */
/**
 * The board is curated, not a pile of every panel: an operator opening it in the morning
 * gets the queue, the volume, and the token/spend detail — in an order that already reads
 * top-down. There is no arrange mode; the page is the layout.
 *
 * `needs-review` and `recent-tickets` were removed by request: that work happens on the
 * Conversations and Tickets pages, not on a dashboard.
 */
const p = (
  id: string, type: PanelType, span: number, options: PanelSpec["options"] = {},
): PanelSpec => ({ id, type, title: "", span, options });

export const DEFAULT_LAYOUT: PanelSpec[] = [
  p("attention", "attention", 12),
  p("kpis", "kpis", 12),
  p("trend", "trend", 8),
  p("quality", "quality", 4),
  p("domains", "domains", 6),
  p("knowledge", "knowledge", 6),
  p("health", "health", 12),
];

export const DEFAULT_LAYOUT_ADMIN: PanelSpec[] = [
  p("attention", "attention", 12),
  p("usage", "usage-kpis", 12),
  p("kpis", "kpis", 12),
  p("trend", "trend", 8),
  p("outcome", "outcome-mix", 4),
  p("cost", "cost-trend", 6),
  p("tokens", "token-breakdown", 6),
  p("model-cost", "model-cost", 6),
  p("domains", "domains", 6),
  p("knowledge", "knowledge", 6),
  p("health", "health", 6),
  p("guardrails", "guardrail-events", 12, { limit: 8 }),
];

/** The board for a role. Agents see operations; administrators also see usage and spend. */
export function layoutFor(role: string | undefined): PanelSpec[] {
  return role === "admin" ? DEFAULT_LAYOUT_ADMIN : DEFAULT_LAYOUT;
}

export const ADMIN_ONLY_PANELS: readonly string[] = [
  "usage-kpis", "cost-trend", "model-cost", "token-breakdown", "guardrail-events",
];
