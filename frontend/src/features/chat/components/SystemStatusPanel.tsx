/**
 * SystemStatus + QuickActions — the two blocks the reference mockup puts at the bottom
 * of the right panel (docs/design/chat-ui-reference.md).
 *
 * SystemStatus reuses `GET /api/dashboard/health`, the same live-probe endpoint the
 * header chips use, so the two surfaces can never disagree about whether a dependency is
 * up. It lists only the services the endpoint actually reported: a row is never invented
 * to make the panel look complete.
 *
 * QuickActions are real actions, not decoration. Each one dispatches `ith:ask` with a
 * question, which ChatPage drops into the composer — the user still sees and can edit
 * the prompt before sending, so a quick action can never silently fire a request. The
 * ticket action navigates instead, because filing a ticket is a different task from
 * asking a question.
 */
import { useEffect, useState } from "react";
import { Activity, KeyRound, Plus, Ticket } from "lucide-react";

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
  const ask = (prompt: string) =>
    window.dispatchEvent(new CustomEvent("ith:ask", { detail: prompt }));

  return (
    <>
      <div className="border-t border-[var(--border)] px-3 py-3" data-testid="system-status">
        <div className="mb-2 flex items-center gap-1.5">
          <Activity className="size-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground">
            System status{healthy > 0 ? ` - ${healthy} healthy` : ""}
          </h3>
        </div>
        {rows.length === 0 ? (
          <p className="text-2xs text-muted-foreground">
            {services === null ? "Checking…" : "Health check reported no services."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((s) => {
              const tone = toneOf(s);
              return (
                <li key={s.key} className="flex items-center gap-2 text-2xs">
                  <span className={`size-1.5 shrink-0 rounded-full ${TONE[tone]}`} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
                  <span className="shrink-0 font-medium text-foreground">{s.status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-[var(--border)] px-3 py-3" data-testid="quick-actions">
        <h3 className="mb-2 text-xs font-semibold text-foreground">Quick actions</h3>
        <div className="flex flex-col gap-1.5">
          {[
            { label: "Reset password", icon: KeyRound, prompt: "How do I reset my password?" },
            { label: "Check service status", icon: Activity, prompt: "Check the status of all services" },
          ].map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => ask(a.prompt)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-2xs font-medium text-foreground transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <a.icon className="size-3 shrink-0 text-muted-foreground" />
              {a.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onNavigate?.("tickets")}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-2xs font-medium text-foreground transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Plus className="size-3 shrink-0 text-muted-foreground" />
            Create IT Ticket
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("tickets")}
            className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-left text-2xs font-medium text-foreground transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <Ticket className="size-3 shrink-0 text-muted-foreground" />
            My tickets
          </button>
        </div>
      </div>
    </>
  );
}
