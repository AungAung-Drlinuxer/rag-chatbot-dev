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
  | "needs-review"
  | "recent-tickets"
  | "domains"
  | "knowledge"
  | "health"
  | "note";

export type PanelSpec = {
  id: string;
  type: PanelType;
  title: string;
  /** Width in a 12-column grid. 12 = full width, 6 = half, 4 = third. */
  span: number;
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

export const PANEL_CATALOGUE: PanelCatalogueEntry[] = [
  { type: "attention", label: "Needs attention", defaultSpan: 12,
    description: "Failing dependencies, low-confidence answers and guardrail signals." },
  { type: "kpis", label: "Volume KPI tiles", defaultSpan: 12,
    description: "Conversations, resolved by bot, escalations and active users." },
  { type: "trend", label: "Conversations over time", defaultSpan: 8,
    description: "Daily volume split by outcome, for the selected reporting window." },
  { type: "quality", label: "Answer quality", defaultSpan: 4,
    description: "Resolved / escalated split plus the confidence-gate pass rate." },
  { type: "needs-review", label: "Needs review", defaultSpan: 6,
    description: "Conversations that were escalated or answered with caution." },
  { type: "recent-tickets", label: "Recent tickets", defaultSpan: 6,
    description: "Latest Jira tickets with status and priority." },
  { type: "domains", label: "Knowledge by domain", defaultSpan: 6,
    description: "How the indexed knowledge base is distributed across domains." },
  { type: "knowledge", label: "Workspace", defaultSpan: 6,
    description: "Indexed articles and blocked attacks (admin)." },
  { type: "health", label: "System health", defaultSpan: 6,
    description: "Every dependency with latency, plus guardrail activity." },
  { type: "note", label: "Text note", defaultSpan: 6,
    description: "Your own note — runbook link, rotation reminder, anything.", repeatable: true },
];

export const DEFAULT_LAYOUT: PanelSpec[] = [
  { id: "attention", type: "attention", title: "", span: 12, options: {} },
  { id: "kpis", type: "kpis", title: "", span: 12, options: {} },
  { id: "trend", type: "trend", title: "", span: 8, options: {} },
  { id: "quality", type: "quality", title: "", span: 4, options: {} },
  { id: "review", type: "needs-review", title: "", span: 6, options: { limit: 5 } },
  { id: "tickets", type: "recent-tickets", title: "", span: 6, options: { limit: 5 } },
  { id: "domains", type: "domains", title: "", span: 6, options: {} },
  { id: "knowledge", type: "knowledge", title: "", span: 6, options: {} },
  { id: "health", type: "health", title: "", span: 6, options: {} },
];

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
