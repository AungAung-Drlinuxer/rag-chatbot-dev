/** Tickets feature domain model — types + display metadata (no React, no fetch). */

export type Ticket = {
  id: string;
  subject: string;
  description?: string;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  requester: string;
  assignee?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
};

export type Comment = { id: number; author?: string | null; body: string; kind: string; created_at?: string | null };
export type Assignable = { username: string; email: string | null; role: string };
export type Attachment = { id: number; filename: string; size: number; created_by: string | null };

export const STATUS_META = {
  open: {
    label: "Open",
    dot: "bg-blue-500",
    className:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300",
  },
  pending: {
    label: "Pending",
    dot: "bg-amber-500",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
  },
  resolved: {
    label: "Resolved",
    dot: "bg-emerald-500",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  },
  closed: {
    label: "Closed",
    dot: "bg-slate-400",
    className:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
  },
};

export const PRIORITY_META = {
  critical: {
    label: "Critical",
    className: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
  },
  high: {
    label: "High",
    className: "text-orange-600 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  medium: {
    label: "Medium",
    className: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  low: {
    label: "Low",
    className: "text-slate-500 dark:text-slate-400",
    dot: "bg-slate-400",
  },
};

export const statusMeta = (s: Ticket["status"]) =>
  STATUS_META[s] ?? {
    label: s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown",
    className:
      "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400",
  };

export const priorityMeta = (pr: Ticket["priority"]) =>
  PRIORITY_META[pr] ?? {
    label: pr ? pr.charAt(0).toUpperCase() + pr.slice(1) : "—",
    className: "text-slate-500 dark:text-slate-400",
    dot: "bg-slate-400",
  };

export function relTime(iso: string) {
  const mins = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  );

  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.round(mins / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.round(hours / 24)}d ago`;
}
