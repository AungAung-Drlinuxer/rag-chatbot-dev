/**
 * DashboardBits.tsx — extracted from DashboardPage.
 *
 * Small presentational pieces: section headers, status badges, report buttons.
 */

import { ArrowUpRight } from "lucide-react";
import { downloadText, printReport } from "@/shared/report";
import { ReportActions } from "@/shared/ReportActions";
import { Badge } from "@/components/ui/badge";
import type { Conversation, RecentTicket } from "@/features/dashboard/lib/dashboardTypes";
import { dashboardCsv } from "@/features/dashboard/lib/dashboardUtils";

export function SectionHeader({
  title,
  description,
  pill,
  action,
  href,
}: {
  title: string;
  /** Optional muted caption under the heading. */
  description?: string;
  /** Optional count pill on the right — the mockup's list-header treatment. */
  pill?: string;
  action?: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {pill && (
          <span className="rounded-md bg-[var(--muted)] px-2 py-0.5 text-2xs font-medium text-muted-foreground">
            {pill}
          </span>
        )}
        {action && href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-2xs font-medium text-[var(--accent-foreground)] hover:underline"
          >
            {action}
            <ArrowUpRight className="size-3" />
          </a>
        )}
      </div>
    </div>
  );
}


/* ============================================================
   RESULT BADGE
============================================================ */

export function ResultBadge({
  result,
}: {
  result: Conversation["result"];
}) {
  // v1.5.3 — three-way badge colors: Resolved=emerald, Cautioned=amber, Escalated=orange
  const styles: Record<string, string> = {
    // Semantic tokens, not palette literals: the same badge has to hold in the light and
    // the charcoal-navy theme without a dark: twin for every tone.
    Resolved:
      "rounded-md border-[var(--ok)]/30 bg-[var(--ok)]/10 text-2xs text-[var(--ok)]",
    Cautioned:
      "rounded-md border-[var(--warn)]/30 bg-[var(--warn)]/10 text-2xs text-[var(--warn)]",
    Escalated:
      "rounded-md border-[var(--danger)]/30 bg-[var(--danger)]/10 text-2xs text-[var(--danger)]",
  };
  return (
    <Badge
      variant="outline"
      className={styles[result] ?? styles.Escalated}
    >
      {result}
    </Badge>
  );
}

/* ============================================================
   STATUS BADGE
============================================================ */

export function StatusBadge({
  status,
}: {
  status: RecentTicket["status"];
}) {
  const styles = {
    Open: "border-[var(--primary)]/30 bg-[var(--accent-soft)] text-[var(--accent-foreground)]",
    Pending: "border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]",
    Resolved: "border-[var(--ok)]/30 bg-[var(--ok)]/10 text-[var(--ok)]",
  };

  return (
    <Badge
      variant="outline"
      className={`rounded-md text-2xs ${styles[status]}`}
    >
      {status}
    </Badge>
  );
}

/* ============================================================
   PRIORITY
============================================================ */

export function PriorityBadge({
  priority,
}: {
  priority: RecentTicket["priority"];
}) {
  const styles = {
    Critical: "bg-[var(--danger)]",
    High: "bg-[var(--warn)]",
    Medium: "bg-[var(--accent-foreground)]/60",
    Low: "bg-[var(--ok)]",
  };

  return (
    <span className="flex w-16 shrink-0 items-center gap-1.5 text-2xs">

      <span
        className={`size-1.5 rounded-full ${styles[priority]}`}
      />

      {priority}

    </span>
  );
}

/* ============================================================
   HEALTH ROW
============================================================ */

export function DashboardReportButtons({ stats, conversations, tickets, domains }: {
  stats: any; conversations: any[]; tickets: any[]; domains: any[];
}) {
  function exportCsv() {
    downloadText(
      `dashboard-report-${new Date().toISOString().slice(0, 10)}.csv`,
      dashboardCsv(stats, conversations, tickets, domains),
      "text/csv;charset=utf-8",
    );
  }

  /* The dashboard's report is the same sheet every other page prints — KPI row, then one
     titled table per panel — so a printed pack never mixes two house styles. */
  function printReportSheet() {
    printReport({
      title: "Workspace overview",
      subtitle: "Dashboard",
      kpis: stats ? [
        { label: "Total questions", value: String(stats.total ?? "—") },
        { label: "Answered from KB", value: String(stats.answered ?? "—") },
        { label: "Escalated", value: String(stats.escalated_to_tickets ?? "—") },
        { label: "Avg confidence", value: String(stats.avg_confidence ?? "—") },
      ] : [],
      sections: [
        {
          title: "Domain breakdown",
          columns: [
            { key: "name", label: "Domain", width: "60%" },
            { key: "count", label: "Count", width: "20%" },
            { key: "share", label: "Share", width: "20%" },
          ],
          rows: (domains ?? []).map((d: any) => ({ name: d.name, count: d.count, share: `${d.percentage}%` })),
        },
        {
          title: "Recent tickets",
          columns: [
            { key: "id", label: "Ticket", width: "26%" },
            { key: "subject", label: "Subject", width: "46%" },
            { key: "status", label: "Status", width: "14%" },
            { key: "priority", label: "Priority", width: "14%" },
          ],
          rows: (tickets ?? []).map((t: any) => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority })),
        },
        {
          title: "Recent conversations",
          columns: [
            { key: "time", label: "Time", width: "18%" },
            { key: "user", label: "User", width: "18%" },
            { key: "question", label: "Question", width: "46%" },
            { key: "result", label: "Result", width: "18%" },
          ],
          rows: (conversations ?? []).map((c: any) => ({ time: c.time, user: c.user, question: c.question, result: c.result })),
        },
      ],
      meta: [`Tickets: ${(tickets ?? []).length}`, `Conversations: ${(conversations ?? []).length}`],
    });
  }

  return (
    <>
      <ReportActions onPrint={printReportSheet} onExport={exportCsv} />
    </>
  );
}
