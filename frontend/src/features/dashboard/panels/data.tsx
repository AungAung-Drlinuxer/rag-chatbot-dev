/**
 * The data every panel reads.
 *
 * One provider at the page level loads the seven endpoints once and hands the result to the
 * panels through context. Panels are therefore pure renderers: adding, duplicating or
 * reordering one never adds an HTTP request, and a panel type that needs no data (a note)
 * costs nothing at all.
 */
import { createContext, useContext, type ReactNode } from "react";

import type { Conversation, Domain, HealthItem, RecentTicket } from "@/features/dashboard/lib/dashboardTypes";
import type { ReportWindow } from "@/features/dashboard/api";

export type Totals = {
  total: number;
  resolved: number;
  escalated: number;
  unresolved: number;
  resolvedPct: number;
  escalatedPct: number;
  unresolvedPct: number;
  gateAnswered: number;
  gateCautioned: number;
  gateTotal: number;
  gatePassPct: number | null;
  openTickets: number;
};

export type AttentionItem = {
  key: string;
  tone: "danger" | "warn" | "ok";
  title: string;
  detail: string;
};

export type DeltaProps = {
  change: string | null;
  positive: boolean;
  description: string;
};

export type HealthSummary = { overall: string; down: string[]; guardrailEvents: number };

export type GatePoint = { day: string; answered: number; cautioned: number };

export type SeriesPoint = { day: string; total: number; resolved: number; escalated: number };

export type DashboardData = {
  role?: string;
  loading: boolean;
  loadError: string | null;
  stats: Record<string, any> | null;
  series: SeriesPoint[];
  gateTrend: GatePoint[];
  domains: Domain[];
  conversations: Conversation[];
  tickets: RecentTicket[];
  health: HealthItem[];
  healthSummary: HealthSummary;
  totals: Totals;
  needsReview: Conversation[];
  attention: AttentionItem[];
  healthDown: string[];
  win: ReportWindow;
  rangeLabel: string;
  deltaProps: (key: string, current: number) => DeltaProps;
  refresh: () => void;
};

const Ctx = createContext<DashboardData | null>(null);

export function DashboardDataProvider({ value, children }: { value: DashboardData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboardData(): DashboardData {
  const value = useContext(Ctx);
  if (!value) throw new Error("useDashboardData must be used inside DashboardDataProvider");
  return value;
}
