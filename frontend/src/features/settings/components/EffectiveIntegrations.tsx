import { useEffect, useState } from "react";
import { KeyRound, Layers, ShieldCheck, Ticket } from "lucide-react";

import { getSetupReadiness, listConnections, type SetupReadiness } from "@/features/settings/api";

/**
 * The integrations tab's read-out — the same "Effective configuration" rail the other
 * tabs carry. It answers what is actually in force, in one place: how many sites each
 * provider has, how much knowledge is indexed, whether ticketing is wired, and that
 * credentials are write-only. Nothing here is editable; the panels below are.
 */
export default function EffectiveIntegrations() {
  const [sites, setSites] = useState<{ confluence: number; jira: number } | null>(null);
  const [ready, setReady] = useState<SetupReadiness | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([listConnections("confluence"), listConnections("jira"), getSetupReadiness()]).then(
      ([c, j, r]) => {
        if (!alive) return;
        const count = (v: PromiseSettledResult<{ connections: unknown[] }>) =>
          v.status === "fulfilled" ? v.value.connections.length : 0;
        setSites({ confluence: count(c), jira: count(j) });
        if (r.status === "fulfilled") setReady(r.value);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  const rows: { key: string; label: string; value: string; icon: typeof Layers }[] = [
    {
      key: "knowledge",
      label: "Knowledge",
      value: sites == null
        ? "…"
        : sites.confluence > 0
          ? `${sites.confluence} site${sites.confluence === 1 ? "" : "s"}${ready ? ` · ${ready.knowledge.articles} articles` : ""}`
          : "Not configured",
      icon: Layers,
    },
    {
      key: "ticketing",
      label: "Ticketing",
      value: sites == null ? "…" : sites.jira > 0 ? `${sites.jira} Jira site${sites.jira === 1 ? "" : "s"}` : "Not configured",
      icon: Ticket,
    },
    {
      key: "identity",
      label: "Identity",
      value: ready ? (ready.steps.find((s) => s.key === "identity")?.status === "done" ? "Administrator signed in" : "Needs setup") : "…",
      icon: ShieldCheck,
    },
    {
      key: "secrets",
      label: "Credentials",
      value: "Write-only, server-side",
      icon: KeyRound,
    },
  ];

  return (
    <section data-slot="effective-config" className="rounded-2xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Effective configuration</h2>
        {ready?.ready ? <Pill>Ready</Pill> : <Pill>Checking…</Pill>}
      </div>
      <dl className="mt-3 divide-y divide-[var(--border)] text-xs">
        {rows.map(({ key, label, value, icon: Icon }) => (
          <div key={key} className="flex items-start justify-between gap-3 py-2">
            <dt className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Icon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </dt>
            <dd className="min-w-0 text-right font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
        Switching a provider on only reveals its panel. Nothing connects until you save that
        panel's fields.
      </p>
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}
