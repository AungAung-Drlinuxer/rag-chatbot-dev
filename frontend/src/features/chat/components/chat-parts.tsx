import { prettyName } from "@/features/chat/model";
import {
  ArrowRight,
  Bot,
  Database,
  Globe,
  HelpCircle,
  Layers,
  Network,
  Server,
  Shield,
} from "lucide-react";

const DOMAIN_ICONS: Record<string, { icon: any; color: string; bg: string }> = {
  database: { icon: Database, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-950/40" },
  network: { icon: Network, color: "text-teal-600", bg: "bg-teal-50 dark:bg-teal-950/40" },
  security: { icon: Shield, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/40" },
  server: { icon: Server, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-950/40" },
  kubernetes: { icon: Layers, color: "text-sky-600", bg: "bg-sky-50 dark:bg-sky-950/40" },
  help_desk: { icon: HelpCircle, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-950/40" },
  general: { icon: Globe, color: "text-slate-600", bg: "bg-slate-100 dark:bg-slate-800" },
};

const SUGGESTIONS = [
  {
    key: "database",
    title: "Database Performance & Locks",
    desc: "PostgreSQL, Oracle, deadlocks & slow queries",
    question: "How do I diagnose and resolve PostgreSQL connection timeouts and lock issues?",
  },
  {
    key: "network",
    title: "VPN & Remote Access",
    desc: "VPN gateway, Wi-Fi, DNS & firewall troubleshooting",
    question: "What are the standard troubleshooting steps for VPN connection failures?",
  },
  {
    key: "security",
    title: "Account & Password Reset",
    desc: "Active Directory, MFA token reset & unlock account",
    question: "How do I reset my password and re-sync my MFA token?",
  },
  {
    key: "kubernetes",
    title: "Kubernetes & Cloud Workloads",
    desc: "CrashLoopBackOff, pod restarts & ingress routing",
    question: "How do I troubleshoot pods stuck in CrashLoopBackOff?",
  },
];

export function EmptyChat({ onSuggestion, userName }: { onSuggestion: (question: string) => void; userName?: string }) {
  const chipFor = (key: string) => DOMAIN_ICONS[key] ?? DOMAIN_ICONS.general;

  // v1.5.2 — time-based personalized greeting (Perplexity-style)
  const h = new Date().getHours();
  const timeGreeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  // S3.12 — was showing the raw login ("ui-reviewer"). prettyName() derives a
  // readable label from the username — it never invents a legal name.
  const displayName = prettyName(userName);
  const greeting = displayName ? `${timeGreeting}, ${displayName.split(" ")[0]}` : timeGreeting;

  // S2.5 — was max-w-2xl (672px) inside a 1000px message column, so the cards
  // read as a narrow island. max-w-3xl keeps the two-up grid balanced.
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-6 sm:py-10">
      {/* ============ GREETING HEADER (Clean, modern, Perplexity/ChatGPT style) ============ */}
      <div className="mb-6 text-center sm:mb-8">
        <div className="mx-auto mb-3.5 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#4338ca] via-[#7c3aed] to-[#6366f1] text-white shadow-md shadow-blue-600/20">
          <Bot className="size-6" strokeWidth={2} />
        </div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
          {greeting} 👋
        </h1>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-slate-500 dark:text-slate-400 sm:text-sm">
          Ask any IT question — answers are grounded in your internal knowledge base.
        </p>
      </div>

      {/* ============ PROMPT SUGGESTION CARDS (Clean, compact 2x2 grid) ============ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => {
          const meta = chipFor(s.key);
          const Icon = meta.icon;
          return (
            <button
              key={s.title}
              type="button"
              onClick={() => onSuggestion(s.question)}
              className="group flex items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-xs transition hover:border-blue-400 hover:bg-slate-50/70 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/60"
            >
              <div className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ${meta.bg}`}>
                <Icon className={`size-4 ${meta.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400">
                    {s.title}
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 text-slate-300 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-slate-600" />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  {s.desc}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={good ? "font-medium text-emerald-600" : "font-medium text-foreground"}>{value}</span>
    </div>
  );
}
