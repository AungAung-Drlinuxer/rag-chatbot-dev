/** Tickets feature domain model — types + display metadata (no React, no fetch). */

export type Ticket = {
  id: string;
  subject: string;
  description?: string;
  /** Jira's own workflow, verbatim: OPEN / PENDING / WORK IN PROGRESS / DONE / REOPENED. */
  status: "open" | "pending" | "in_progress" | "done" | "reopened";
  priority: "critical" | "high" | "medium" | "low";
  category: string;
  requester: string;
  assignee?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
};

export type Comment = { id: number; author?: string | null; body: string; kind: string; created_at?: string | null };
export type Assignable = {
  username: string;
  email: string | null;
  role: string;
  /** Present when the pool came from a category mapping — the team the person was found in. */
  group?: string | null;
};
export type Attachment = { id: number; filename: string; size: number; created_by: string | null };

export const STATUS_META = {
  open: {
    label: "Open",
    dot: "bg-[var(--primary)]",
    className: "border-[var(--border)] bg-muted text-foreground",
  },
  pending: {
    label: "Pending",
    dot: "bg-[var(--warn)]",
    className: "border-[var(--warn)]/40 bg-[var(--warn)]/10 text-foreground",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-[var(--primary)]",
    className:
      "border-[var(--primary)]/35 bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
  },
  done: {
    label: "Done",
    dot: "bg-[var(--ok)]",
    className: "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-foreground",
  },
  reopened: {
    label: "Reopened",
    dot: "bg-[var(--danger)]",
    className: "border-[var(--danger)]/40 bg-[var(--danger)]/10 text-foreground",
  },
} as const;

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
