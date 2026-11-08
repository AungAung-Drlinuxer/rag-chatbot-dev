/**
 * The shapes the dashboard API returns, in one place.
 *
 * These were declared inline at the top of a 1,949-line page, so every extracted
 * sub-component had to import its types from the page that used it. The dependency
 * now points at the data, not at the screen.
 */
import type { ReactNode } from "react";

export type Props = {
  userName?: string;
  role?: string;
  // `onNavigate` went with the Quick actions row: it was that row's only reader, and
  // App.tsx never passed it (the sidebar is the navigation path).
};

export type Conversation = {
  time: string;
  user: string;
  question: string;
  result: "Resolved" | "Escalated";
};

export type RecentTicket = {
  id: string;
  subject: string;
  status: "Open" | "Pending" | "Resolved";
  priority: "Critical" | "High" | "Medium" | "Low";
};

export type Domain = {
  name: string;
  count: number;
  percentage: number;
  icon: ReactNode;
};

export type HealthItem = {
  /** #12 — stable backend key (postgres/redis/ollama/llm/jira/...) for the icon */
  key?: string;
  name: string;
  status: "Healthy" | "Degraded" | "Down";
  /** #12 — why a dependency is down (first line of the real error) */
  detail?: string | null;
  latency_ms?: number | null;
  icon: ReactNode;
};

/* ============================================================
   SAMPLE DATA
   Replace these with API data later.
============================================================ */


/* ============================================================
   MAIN DASHBOARD
============================================================ */
