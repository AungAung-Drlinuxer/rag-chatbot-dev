/**
 * dashboardUtils.tsx — extracted from DashboardPage.
 *
 * Pure helpers — formatting, tick maths, CSV, the profanity filter. No React state.
 */

import {
  Activity,
  BookOpen,
  Cpu,
  Database,
  Server,
  Ticket,
  Users,
} from "lucide-react";

export function healthIcon(key?: string) {
  const cls = "size-3.5";
  switch ((key || "").toLowerCase()) {
    case "postgres":
      return <Database className={cls} />;
    case "redis":
      return <Activity className={cls} />;
    case "ollama":
    case "llm":
      return <Cpu className={cls} />;
    case "jira":
      return <Ticket className={cls} />;
    case "confluence":
      return <BookOpen className={cls} />;
    case "ldap":
      return <Users className={cls} />;
    default:
      return <Server className={cls} />;
  }
}

const _PROFANITY_RE = new RegExp(
  "\\b(f+u+c+k+|sh+i+t+|b+i+t+c+h+|a+s+s+h+o+l+e+|d+a+m+n+)\\b",
  "gi"
);

export function maskProfanity(text: string): string {
  return (text || "").replace(_PROFANITY_RE, (m) => "✱".repeat(Math.min(6, m.length)));
}

/**
 * #9 — round a raw tick spacing up to the nearest "nice" number (1, 2, 2.5, 5, 10 x 10^n).
 * Chart axes that use a raw max/4 spacing produce labels like 18, 35, 53.
 */

export function niceTickStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return Math.max(1, nice * mag);
}

export function dashboardCsv(stats: any, conversations: any[], tickets: any[], domains: any[]): string {
  const lines: string[] = [];
  const stamp = new Date().toISOString().slice(0, 10);
  lines.push(`IT Help Chatbot - Dashboard Report,${stamp}`);
  lines.push("");
  lines.push("SUMMARY");
  lines.push("Metric,Value");
  if (stats) {
    lines.push(`Total questions,${stats.total ?? ""}`);
    lines.push(`Answered from KB,${stats.answered ?? ""}`);
    lines.push(`Escalated to tickets,${stats.escalated_to_tickets ?? ""}`);
    lines.push(`Avg confidence,${stats.avg_confidence ?? ""}`);
  }
  lines.push("");
  lines.push("DOMAIN BREAKDOWN");
  lines.push("Domain,Count,Percentage");
  (domains ?? []).forEach((d) => lines.push(`"${d.name}",${d.count},${d.percentage}%`));
  lines.push("");
  lines.push("RECENT TICKETS");
  lines.push("Ticket,Subject,Status,Priority");
  (tickets ?? []).forEach((t) => lines.push(`"${t.id}","${String(t.subject).replace(/"/g, '""')}",${t.status},${t.priority}`));
  lines.push("");
  lines.push("RECENT CONVERSATIONS");
  lines.push("Time,User,Question,Result");
  (conversations ?? []).forEach((c) =>
    lines.push(`${c.time},"${c.user}","${String(c.question).replace(/"/g, '""')}",${c.result}`));
  return lines.join("\n");
}
