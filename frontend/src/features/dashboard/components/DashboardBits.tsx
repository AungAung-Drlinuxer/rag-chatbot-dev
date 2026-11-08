/**
 * DashboardBits.tsx — extracted from DashboardPage.
 *
 * Small presentational pieces: section headers, status badges, report buttons.
 */

import {
  ArrowUpRight,
  Download,
  Printer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    const body = dashboardCsv(stats, conversations, tickets, domains);
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dashboard-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rows = (tickets ?? []).map((t) =>
      `<tr><td>${esc(t.id)}</td><td>${esc(t.subject)}</td><td>${esc(t.status)}</td><td>${esc(t.priority)}</td></tr>`).join("");
    const convRows = (conversations ?? []).map((c) =>
      `<tr><td>${esc(c.time)}</td><td>${esc(c.user)}</td><td>${esc(c.question)}</td><td>${esc(c.result)}</td></tr>`).join("");
    const domRows = (domains ?? []).map((d) =>
      `<tr><td>${esc(d.name)}</td><td>${esc(d.count)}</td><td>${esc(d.percentage)}%</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Dashboard Report</title><style>
      body{font-family:Arial,sans-serif;margin:32px;color:#0f172a}
      h1{font-size:18px;margin:0 0 4px}.meta{font-size:12px;color:#64748b;margin-bottom:16px}
      h2{font-size:14px;margin:20px 0 6px}
      table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:12px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
      th{background:#f1f5f9}tr:nth-child(even) td{background:#f8fafc}
      .kpis{display:flex;gap:16px;font-size:13px}
      .kpi{border:1px solid #cbd5e1;border-radius:8px;padding:8px 14px}
      @media print{button{display:none}}
    </style></head><body>
      <h1>IT Help Chatbot — Dashboard Report</h1>
      <div class="meta">Generated ${new Date().toLocaleString()}</div>
      ${stats ? `<div class="kpis">
        <div class="kpi"><b>${esc(stats.total ?? "—")}</b><br>Total questions</div>
        <div class="kpi"><b>${esc(stats.answered ?? "—")}</b><br>Answered from KB</div>
        <div class="kpi"><b>${esc(stats.escalated_to_tickets ?? "—")}</b><br>Escalated</div>
        <div class="kpi"><b>${esc(stats.avg_confidence ?? "—")}</b><br>Avg confidence</div>
      </div>` : ""}
      <h2>Domain Breakdown</h2>
      <table><thead><tr><th>Domain</th><th>Count</th><th>Share</th></tr></thead><tbody>${domRows}</tbody></table>
      <h2>Recent Tickets</h2>
      <table><thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Recent Conversations</h2>
      <table><thead><tr><th>Time</th><th>User</th><th>Question</th><th>Result</th></tr></thead><tbody>${convRows}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`);
    w.document.close();
  }

  return (
    <>
      <Button variant="outline" size="sm" className="rounded-xl" onClick={exportCsv} title="Download all dashboard data as CSV">
        <Download className="mr-1.5 size-3.5" />
        Export CSV
      </Button>
      <Button variant="outline" size="sm" className="rounded-xl" onClick={printReport} title="Open a printable report in a new tab">
        <Printer className="mr-1.5 size-3.5" />
        Report
      </Button>
    </>
  );
}
