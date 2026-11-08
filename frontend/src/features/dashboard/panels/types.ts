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
  /** Column 0–11. Absent on layouts saved before the board became a positionable grid. */
  x?: number;
  /** Row the panel starts at, in grid rows. */
  y?: number;
  /** Height in grid rows. */
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

export const MIN_SPAN = 3;
export const MAX_SPAN = 12;
/** Minimum and maximum panel height, in grid rows (see panels/grid.ts). */
export const MIN_HEIGHT = 2;
export const MAX_HEIGHT = 12;

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
 * The board is curated, not a pile of every panel: an operator opening it in the morning gets
 * the queue, the volume, and the token/spend detail they asked for — in a layout that is
 * already right, so nothing needs rearranging before it is useful.
 *
 * `needs-review` and `recent-tickets` were removed by request; their work happens on the
 * Tickets and Conversations pages, not on a dashboard.
 */
const p = (
  id: string, type: PanelType, span: number, x: number, y: number, h: number,
  options: PanelSpec["options"] = {},
): PanelSpec => ({ id, type, title: "", span, x, y, h, options });

export const DEFAULT_LAYOUT: PanelSpec[] = [
  p("attention", "attention", 12, 0, 0, 2),
  p("kpis", "kpis", 12, 0, 2, 3),
  p("trend", "trend", 8, 0, 5, 5),
  p("quality", "quality", 4, 8, 5, 5),
  p("domains", "domains", 6, 0, 10, 4),
  p("knowledge", "knowledge", 6, 6, 10, 4),
  p("health", "health", 12, 0, 14, 5),
];

export const DEFAULT_LAYOUT_ADMIN: PanelSpec[] = [
  p("attention", "attention", 12, 0, 0, 2),
  p("usage", "usage-kpis", 12, 0, 2, 2),
  p("kpis", "kpis", 12, 0, 4, 3),
  p("trend", "trend", 8, 0, 7, 5),
  p("outcome", "outcome-mix", 4, 8, 7, 5),
  p("cost", "cost-trend", 6, 0, 12, 5),
  p("tokens", "token-breakdown", 6, 6, 12, 5),
  p("model-cost", "model-cost", 6, 0, 17, 4),
  p("domains", "domains", 6, 6, 17, 4),
  p("knowledge", "knowledge", 6, 0, 21, 4),
  p("health", "health", 6, 6, 21, 4),
  p("guardrails", "guardrail-events", 12, 0, 25, 4, { limit: 8 }),
];

/** Panels that read the observability endpoints — administrator only, like the Audit log. */
export const ADMIN_ONLY_PANELS: readonly string[] = [
  "usage-kpis", "cost-trend", "model-cost", "token-breakdown", "guardrail-events",
];

export function defaultLayoutFor(role?: string): PanelSpec[] {
  return role === "admin" ? DEFAULT_LAYOUT_ADMIN : DEFAULT_LAYOUT;
}

export function catalogueFor(type: string): PanelCatalogueEntry | undefined {
  return PANEL_CATALOGUE.find((entry) => entry.type === type);
}

/** Unknown types survive a save round-trip; the renderer shows a labelled placeholder. */
export function isKnownType(type: string): type is PanelType {
  return PANEL_CATALOGUE.some((entry) => entry.type === type);
}

export function newPanelId(): string {
  return `p-${Math.random().toString(36).slice(2, 9)}`;
}

export function panelTitle(panel: PanelSpec): string {
  return panel.title?.trim() || catalogueFor(panel.type)?.label || "Panel";
}
