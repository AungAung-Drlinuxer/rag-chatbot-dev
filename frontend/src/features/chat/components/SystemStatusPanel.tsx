/**
 * SystemStatus + QuickActions — the two blocks the reference mockup puts at the bottom
 * of the right panel (docs/design/chat-ui-reference.md).
 *
 * SystemStatus reuses `GET /api/dashboard/health`, the same live-probe endpoint the
 * header chips use, so the two surfaces can never disagree about whether a dependency is
 * up. It lists only the services the endpoint actually reported: a row is never invented
 * to make the panel look complete. Each row carries its own glyph and colour so the eye can
 * find "is Redis back?" without reading every line.
 *
 * QuickActions are real actions, not decoration. Asking actions dispatch `ith:ask` with a
 * question, which ChatPage drops into the composer — the user still sees and can edit the
 * prompt before sending, so a quick action can never silently fire a request. "Create
 * ticket" opens the Jira Service Management form instead, because filing a ticket is a
 * different task from asking a question.
 */
import { useEffect, useState } from "react";
import {
  Activity, Cpu, Database, FileText, KeyRound, Plus, Server, ShieldCheck,
  SquareKanban, Ticket, Users, Wifi, Zap,
} from "lucide-react";

import { dashHealth } from "@/features/dashboard/api";

type Service = { key: string; name: string; status: string; latency_ms?: number | null };

const TONE: Record<string, string> = {
  ok: "bg-emerald-500",
  bad: "bg-red-500",
  unknown: "bg-slate-400",
};

function toneOf(s: Service | undefined): keyof typeof TONE {
  if (!s) return "unknown";
  return s.status === "Healthy" ? "ok" : "bad";
}

/** One glyph per dependency, matched on the key/name the health probe returns. */
const GLYPH: { match: RegExp; icon: typeof Database; tint: string }[] = [
  { match: /postgres|database|db$|sql/i, icon: Database, tint: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400" },
  { match: /redis|cache|broker/i, icon: Zap, tint: "text-amber-600 bg-amber-500/10 dark:text-amber-400" },
  { match: /jira/i, icon: SquareKanban, tint: "text-sky-600 bg-sky-500/10 dark:text-sky-400" },
  { match: /confluence|docs?/i, icon: FileText, tint: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-400" },
  { match: /ldap|active directory|ad\b/i, icon: Users, tint: "text-violet-600 bg-violet-500/10 dark:text-violet-400" },
  { match: /keycloak|sso|auth/i, icon: ShieldCheck, tint: "text-rose-600 bg-rose-500/10 dark:text-rose-400" },
  { match: /ollama|llm|embed|model/i, icon: Cpu, tint: "text-fuchsia-600 bg-fuchsia-500/10 dark:text-fuchsia-400" },
  { match: /.*/, icon: Server, tint: "text-slate-600 bg-slate-500/10 dark:text-slate-300" },
];

function glyphFor(s: Service) {
  return GLYPH.find((g) => g.match.test(s.key) || g.match.test(s.name)) ?? GLYPH[GLYPH.length - 1];
}

/** The actions a person actually needs from a support assistant, in that order. */
const ACTIONS: {
  label: string;
  hint: string;
  icon: typeof KeyRound;
  tint: string;
  /** "ask" puts an editable question in the composer; "ticket" opens the JSM form. */
  kind: "ask" | "ticket";
  prompt?: string;
}[] = [
  { label: "Reset my password", hint: "Self-service steps before you call IT", icon: KeyRound,
    tint: "text-violet-600 bg-violet-500/10 dark:text-violet-400", kind: "ask",
    prompt: "How do I reset my password?" },
  { label: "VPN won't connect", hint: "Check the usual causes first", icon: Wifi,
    tint: "text-sky-600 bg-sky-500/10 dark:text-sky-400", kind: "ask",
    prompt: "My VPN will not connect — what should I check?" },
  { label: "My open tickets", hint: "Status of what you already raised", icon: Ticket,
    tint: "text-amber-600 bg-amber-500/10 dark:text-amber-400", kind: "ask",
    prompt: "Show my open tickets" },
  { label: "Create IT ticket", hint: "Raise a request with the right team", icon: Plus,
    tint: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400", kind: "ticket" },
];

export default function SystemStatus({ onNavigate }: { onNavigate?: (nav: string) => void }) {
  const [services, setServices] = useState<Service[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      dashHealth()
        .then((d: any) => {
          if (alive) setServices(Array.isArray(d?.services) ? d.services : []);
        })
        .catch(() => {
          if (alive) setServices([]);
        });
    load();
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const rows = services ?? [];
  /** The mockup's "System status - N healthy": N is the number of services the live
   *  probe reported as Healthy. Nothing is counted that the endpoint did not report. */
  const healthy = rows.filter((s) => s.status === "Healthy").length;
  const allOk = rows.length > 0 && healthy === rows.length;
  const ask = (prompt: string) =>
    window.dispatchEvent(new CustomEvent("ith:ask", { detail: prompt }));

  return (
    <>
      <div className="border-t border-[var(--border)] px-3 py-3" data-testid="system-status">
        <div className="mb-2 flex items-center gap-1.5">
          <span className={`grid size-5 place-items-center rounded-md ${allOk ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>
            <Activity className="size-3" aria-hidden />
          </span>
          <h3 className="text-xs font-semibold text-foreground">
            System status{healthy > 0 ? ` — ${healthy} healthy` : ""}
          </h3>
          {allOk && <ShieldCheck className="ml-auto size-3.5 text-emerald-500" aria-label="All services healthy" />}
        </div>
        {rows.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            {services === null ? "Checking…" : "Health check reported no services."}
          </p>
        ) : (
          <ul className="space-y-1">
            {rows.map((s) => {
              const tone = toneOf(s);
              const g = glyphFor(s);
              return (
                <li key={s.key} className="flex items-center gap-2 rounded-lg px-1 py-0.5 text-2xs">
                  <span className={`grid size-5 shrink-0 place-items-center rounded-md ${g.tint}`}>
                    <g.icon className="size-3" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.name}>{s.name}</span>
                  <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
                    <span className={`size-1.5 rounded-full ${TONE[tone]}`} aria-hidden />
                    {s.status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-3" data-testid="quick-actions">
        <h3 className="mb-2 text-xs font-semibold text-foreground">Quick actions</h3>
        <div className="flex flex-col gap-1.5">
          {ACTIONS.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => (a.kind === "ticket"
                ? window.dispatchEvent(new CustomEvent("ith:open-ticket"))
                : ask(a.prompt ?? a.label))}
              title={a.hint}
              className="group flex items-center gap-2 rounded-lg border border-[var(--border)] bg-card px-2 py-1.5 text-left transition hover:border-[var(--primary)]/40 hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span className={`grid size-6 shrink-0 place-items-center rounded-md ${a.tint}`}>
                <a.icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs font-semibold text-foreground">{a.label}</span>
                <span className="block truncate text-3xs text-muted-foreground">{a.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onNavigate?.("tickets")}
          className="mt-1.5 w-full rounded-lg px-2 py-1 text-left text-3xs font-medium text-muted-foreground underline-offset-2 hover:text-[var(--primary)] hover:underline"
        >
          Open the ticket queue →
        </button>
      </div>
    </>
  );
}
