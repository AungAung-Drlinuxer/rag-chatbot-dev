/**
 * SetupChecklist — "is this installation actually usable?" on the Integrations screen.
 *
 * The values come from GET /api/setup/readiness, which reads the database and the saved
 * integration rows; nothing here is guessed. A step that the UI cannot fix (a missing
 * pgvector extension, no administrator account) is shown as `blocked` with the exact
 * command, because sending an admin to hunt through Settings for a server-side problem is
 * worse than telling them what to run.
 *
 * When everything is done the card collapses to one quiet line — the checklist exists to
 * get an install finished, not to decorate a finished one.
 */
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CircleDashed, Loader2, ShieldAlert } from "lucide-react";

import { getSetupReadiness, type SetupReadiness, type SetupStep } from "@/features/settings/api";

const STATUS_STYLE: Record<SetupStep["status"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  done: { icon: CheckCircle2, className: "text-[var(--ok)]", label: "Done" },
  todo: { icon: CircleDashed, className: "text-[var(--warn)]", label: "To do" },
  blocked: { icon: ShieldAlert, className: "text-[var(--danger)]", label: "Needs server access" },
};

export default function SetupChecklist() {
  const [data, setData] = useState<SetupReadiness | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getSetupReadiness()
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed || !data) {
    // Silent on failure: the Integrations screen must still work when this one call fails,
    // and a red "readiness unavailable" banner on every load is noise, not information.
    return failed ? null : (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Checking installation readiness…
      </div>
    );
  }

  const pending = data.steps.filter((s) => s.status !== "done");

  if (pending.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-[var(--ok)]" />
        Installation ready — {data.database.tables} tables, pgvector {data.database.vector_version}
        {data.knowledge.articles > 0 && ` · ${data.knowledge.articles} indexed articles`}
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-[var(--border)] bg-[var(--panel)]"
      aria-label="Installation readiness"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
        <AlertCircle className="size-4 text-[var(--warn)]" />
        <h3 className="text-sm font-semibold text-foreground">Finish setting up</h3>
        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-medium text-[var(--accent-foreground)]">
          {pending.length} left
        </span>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {data.steps.map((step) => {
          const style = STATUS_STYLE[step.status];
          const Icon = style.icon;
          return (
            <li key={step.key} className="flex items-start gap-3 px-4 py-2.5">
              <Icon className={`mt-0.5 size-4 shrink-0 ${style.className}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium text-foreground">{step.label}</span>
                  <span className="text-xs text-muted-foreground">{step.detail}</span>
                </div>
                {step.hint && step.status !== "done" && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.hint}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{style.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
