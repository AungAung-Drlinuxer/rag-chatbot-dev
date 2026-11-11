/**
 * Domains & Routing Engine.
 *
 * A domain does two jobs: it selects which knowledge answers a question, and it decides
 * which Jira project receives the escalation. The page is arranged around that mental
 * model — metrics, then the two-step flow, then the domains themselves.
 *
 * Component split (each piece owns one job):
 *   DomainStats        — the four figures, counted from the list
 *   RoutingFlow        — what a domain does, as two steps
 *   DomainRoutingItem  — one domain: identity, state, keywords, actions
 *   DomainClassifierManager — create/edit sheet + list assembly (kept for the editor)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Layers, Plus, Search, SearchX, ShieldAlert, X } from "lucide-react";

import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { ClassifierDomainItem, getClassifierDomains } from "@/features/domains/api";
import { DomainClassifierManager } from "@/features/domains/components/DomainClassifierManager";
import { DomainStats, type DomainTotals } from "@/features/domains/components/DomainStats";
import { RoutingFlow } from "@/features/domains/components/RoutingFlow";
import { domainHealth } from "@/features/domains/components/domainMeta";

type StatusFilter = "all" | "active" | "inactive" | "attention";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "attention", label: "Needs attention" },
];

export default function DomainsPage({
  role,
  perms,
}: {
  role?: string;
  perms?: Record<string, boolean>;
}) {
  const [domains, setDomains] = useState<ClassifierDomainItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  // Bumped by the header's "Add domain" button; the manager watches it and opens its form.
  const [createSignal, setCreateSignal] = useState(0);

  // "Test keywords" — runs the classifier's own keyword rules locally, no backend call.
  const [testerOpen, setTesterOpen] = useState(false);
  const [question, setQuestion] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  const canManage =
    role === "admin" ||
    role === "knowledge" ||
    role === "domain_manager" ||
    !!perms?.manage_domains ||
    !!perms?.manage_users;

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await getClassifierDomains();
      setDomains(res.domains || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load domain configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canManage) loadData();
  }, [canManage, loadData]);

  /** Every figure is counted from the list the API returned. */
  const totals: DomainTotals = useMemo(
    () => ({
      active: domains.filter((d) => d.is_active).length,
      inactive: domains.filter((d) => !d.is_active).length,
      keywords: domains.reduce((n, d) => n + (d.keywords?.length ?? 0), 0),
      routed: domains.filter((d) => !!d.jira_project).length,
      attention: domains.filter((d) => domainHealth(d).length > 0).length,
    }),
    [domains],
  );

  /** Filtered + ordered: the domains that can actually classify come first. */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return domains
      .filter((d) => {
        if (status === "active" && !d.is_active) return false;
        if (status === "inactive" && d.is_active) return false;
        if (status === "attention" && domainHealth(d).length === 0) return false;
        if (!needle) return true;
        const hay = [d.display_name, d.domain_key, d.jira_project ?? "", d.description ?? "", ...(d.keywords ?? [])]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      })
      .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.display_name.localeCompare(b.display_name));
  }, [domains, q, status]);

  const filtered = q.trim() !== "" || status !== "all";

  // Same rule the backend classifier applies: case-insensitive substring match, most
  // matches first. This previews the keyword rules only — not a live classification.
  const matches = useMemo(() => {
    const needle = question.trim().toLowerCase();
    if (!needle) return [];
    return domains
      .filter((d) => d.is_active)
      .map((d) => ({
        domain: d,
        hits: (d.keywords ?? []).filter((k) => k && needle.includes(k.toLowerCase())),
      }))
      .filter((m) => m.hits.length > 0)
      .sort((a, b) => b.hits.length - a.hits.length);
  }, [domains, question]);

  if (!canManage) {
    return (
      <PageShell>
        <PageHeader
          icon={<Layers className="size-5" />}
          title="Domains & routing"
          description="Classifier keywords, domain icons, colours, and Jira escalation routing"
        />
        <main className="mx-auto max-w-3xl">
          <div data-slot="card" className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-card p-10 text-center shadow-xs">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)]">
              <ShieldAlert className="size-6" />
            </div>
            <h3 className="text-base font-semibold">Access restricted</h3>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
              Only the Administrator and Knowledge Manager roles may view or change routing
              domains and classification rules.
            </p>
          </div>
        </main>
      </PageShell>
    );
  }

  const statusCounts: Record<StatusFilter, number> = {
    all: domains.length,
    active: totals.active,
    inactive: totals.inactive,
    attention: totals.attention,
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        breadcrumbs={["Workspace", "Domains & routing"]}
        icon={<Layers className="size-5" />}
        badge={role === "admin" ? "Administrator" : "Knowledge Manager"}
        title="Domains & routing"
        description="Connect every question to the right knowledge and the right team."
        actions={
          <>
            <button
              type="button"
              onClick={() => setTesterOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted"
            >
              <Search className="size-3.5" aria-hidden /> Test keywords
            </button>
            <button
              type="button"
              onClick={() => setCreateSignal((n) => n + 1)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90"
            >
              <Plus className="size-3.5" aria-hidden /> Add domain
            </button>
          </>
        }
      />

      <main className="space-y-4 pb-2">
        <DomainStats totals={totals} loading={loading} />
        <RoutingFlow />

        <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
            <h2 className="text-sm font-semibold">
              Routing domains
              <span className="ml-2 rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                {domains.length}
              </span>
            </h2>
            <p className="text-2xs text-muted-foreground">
              {filtered ? `${visible.length} shown` : "Sorted active first"}
            </p>
          </div>

          {/* Toolbar: search takes the row on mobile; the status switch scrolls sideways
              instead of wrapping into a second paragraph of controls. */}
          <div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-center sm:px-5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search domains"
                placeholder="Search domains, keywords, or Jira project…"
                className="h-9 w-full rounded-lg border border-[var(--border)] bg-background pl-9 pr-8 text-xs outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => { setQ(""); searchRef.current?.focus(); }}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition hover:bg-muted"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div
                role="group"
                aria-label="Filter by status"
                className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-lg border border-[var(--border)] bg-background p-0.5"
              >
                {STATUS_TABS.map((tab) => {
                  const activeTab = status === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      aria-pressed={activeTab}
                      onClick={() => setStatus(tab.key)}
                      className={[
                        "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-2xs font-medium transition",
                        activeTab
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-xs"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                    >
                      {tab.label}
                      <span className={["rounded px-1 text-[10px] font-semibold tabular-nums", activeTab ? "bg-black/15" : "bg-[var(--muted)] text-muted-foreground"].join(" ")}>{statusCounts[tab.key]}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => { setQ(""); setStatus("all"); }}
                disabled={!filtered}
                className="h-9 shrink-0 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-40"
              >
                Reset
              </button>
            </div>
          </div>

          {/* Failure replaces the list — an error banner above a working-looking table was
              the old behaviour and read as "some of this is fine". */}
          {loading && domains.length === 0 ? (
            <div className="space-y-2 border-t border-[var(--border)] p-4 sm:p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl bg-muted"
                  style={{ width: `${90 + ((i * 4) % 10)}%` }}
                />
              ))}
            </div>
          ) : error ? (
            <div className="border-t border-[var(--border)]">
              <ErrorState title="Could not load the domains configuration" detail={error} onRetry={loadData} />
            </div>
          ) : domains.length === 0 ? (
            <div className="border-t border-[var(--border)]">
              <EmptyState
                icon={<Layers className="size-5" />}
                title="No domains configured yet"
                description="Domains group your knowledge and route questions to the right collection. Add one to start classifying incoming content."
              />
            </div>
          ) : visible.length === 0 ? (
            <div className="border-t border-[var(--border)]">
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="No domains match these filters"
                description={`${domains.length} domain${domains.length === 1 ? "" : "s"} configured, but none match the current search or status filter.`}
                actionLabel="Clear filters"
                onAction={() => { setQ(""); setStatus("all"); }}
              />
            </div>
          ) : (
            <div className="border-t border-[var(--border)]">
              <DomainClassifierManager
                domains={visible}
                onRefresh={loadData}
                canManage={canManage}
                hideHeader
                openCreateSignal={createSignal}
              />
            </div>
          )}

          {!loading && !error && domains.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3 text-2xs text-muted-foreground sm:px-5">
              <span>
                Showing {visible.length} of {domains.length} domain{domains.length === 1 ? "" : "s"}
                {filtered ? " (filtered)" : ""}
              </span>
              <span>
                {totals.keywords} keyword{totals.keywords === 1 ? "" : "s"} across {totals.active} active domain
                {totals.active === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </section>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          Edits and keyword tests run against the live classifier configuration. Renaming a
          domain key cascades to its knowledge base articles and vectors.
        </p>
      </main>

      {/* Test keywords — a local preview of the keyword rules, no backend round-trip. */}
      {testerOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Test keyword matching"
          onClick={(e) => { if (e.target === e.currentTarget) setTesterOpen(false); }}
        >
          <div data-slot="card" className="my-auto w-full max-w-lg rounded-2xl border border-[var(--border)] bg-card p-5 shadow-xl sm:p-6">
            <h2 className="text-base font-semibold">Test keyword matching</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              A case-insensitive match against the keywords of active domains. This previews the
              keyword rules only — it does not reproduce the production classifier or query
              Confluence.
            </p>

            <label className="mt-4 block text-xs font-medium">
              Question
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="For example: postgres connection refused"
                rows={3}
                className="mt-2 w-full resize-y rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-xs outline-none focus:border-[var(--primary)]"
              />
            </label>

            <div className="mt-4 rounded-xl border border-[var(--border)] bg-muted/40 p-3 text-xs leading-relaxed">
              {question.trim() === "" ? (
                <span className="text-muted-foreground">
                  Enter a question to see matching domains and Jira targets.
                </span>
              ) : matches.length === 0 ? (
                <span className="text-muted-foreground">
                  No keyword matches. The production classifier also applies fallback rules that
                  are not shown here.
                </span>
              ) : (
                <>
                  {matches.map(({ domain, hits }) => (
                    <div key={domain.id} className="mb-2 last:mb-0">
                      <strong>{domain.display_name}</strong>{" "}
                      <span className="text-muted-foreground">
                        → {domain.jira_project || "No Jira route"}
                      </span>
                      <br />
                      Matched: {hits.join(", ")}
                    </div>
                  ))}
                  <span className="text-2xs text-muted-foreground">
                    Multiple matches are shown without assigning production confidence scores.
                  </span>
                </>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button
                type="button"
                onClick={() => setTesterOpen(false)}
                className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
