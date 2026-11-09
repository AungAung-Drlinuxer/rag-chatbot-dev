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
  /** Band (1-based) on the single-screen board. */
  row?: number;
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
  { type: "token-breakdown", label: "Tokens & cost by model", defaultSpan: 4,
    description: "Answers, tokens in/out and spend per model — the detail behind the total." },
];

/**
 * Two defaults, because the same board serves two jobs: an operator opening the page in the
 * morning needs the queue and the health strip; the same operator at month end needs tokens
 * and spend. Cost is administrator-only (the API refuses it for everyone else), so the tiles
 * are in the admin default and absent from the user default rather than rendering locked.
 */
/**
 * The single-screen board.
 *
 * Bands, top to bottom: what needs a human, what the assistant did, what it cost, what it
 * knows, and what it refused. Admin sees the usage/policy bands; everyone else gets the
 * operational ones. Placement is data so the same panel vocabulary renders both boards.
 */
const p = (
  id: string, type: PanelType, span: number, row: number, options: PanelSpec["options"] = {},
): PanelSpec => ({ id, type, title: "", span, row, options });

export const DEFAULT_LAYOUT: PanelSpec[] = [
  p("kpis", "kpis", 12, 1),
  p("trend", "trend", 8, 2),
  p("quality", "quality", 4, 2),
  p("domains", "domains", 4, 3),
  p("knowledge", "knowledge", 4, 3),
  p("health", "health", 4, 3),
];

export const DEFAULT_LAYOUT_ADMIN: PanelSpec[] = [
  p("kpis", "kpis", 12, 1),
  p("usage", "usage-kpis", 6, 2),
  p("trend", "trend", 6, 2),
  p("domains", "domains", 3, 3),
  p("tokens", "token-breakdown", 3, 3),
  p("health", "health", 3, 3),
  p("knowledge", "knowledge", 3, 3),
  p("guardrails", "guardrail-events", 12, 4, { limit: 6 }),
];

/** The board for a role. Agents see operations; administrators also see usage and spend. */
export function layoutFor(role: string | undefined): PanelSpec[] {
  return role === "admin" ? DEFAULT_LAYOUT_ADMIN : DEFAULT_LAYOUT;
}

/**
 * Band heights. `auto` for the header-adjacent band (it only holds tiles and a one-line
 * alert strip); the rest share the leftover space by weight, so the board fits any desktop
 * height instead of being taller than the screen.
 */
export const BOARD_ROWS_ADMIN =
  "minmax(112px,auto) minmax(190px,1fr) minmax(180px,0.97fr) minmax(150px,0.72fr)";
export const BOARD_ROWS_USER =
  "minmax(112px,auto) minmax(210px,1.2fr) minmax(180px,1fr)";

export const ADMIN_ONLY_PANELS: readonly string[] = [
  "usage-kpis", "cost-trend", "model-cost", "token-breakdown", "guardrail-events",
];
