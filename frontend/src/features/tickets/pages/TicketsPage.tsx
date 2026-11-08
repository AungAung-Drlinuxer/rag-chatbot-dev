import {
  Download,
  Filter,
  Plus,
  Printer,
  RefreshCw,
  Sparkles,
  Ticket as TicketIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { articleDraft } from "@/features/knowledge/api";
import {
  createTicketApi,
  listActiveDomains,
  listTicketDestinations,
  listTickets,
  syncJiraTickets,
  reconcileJiraTickets,
  ticketAddComment,
  ticketAttachmentAdd,
  ticketAttachments,
  ticketComments,
  ticketUpdate,
} from "@/features/tickets/api";
import {
  type Assignable,
  type Attachment,
  type Comment,
  type Ticket,
} from "@/features/tickets/model";
import { RefreshIcon } from "@/features/tickets/components/presentational";
import { TicketDetailPanel } from "@/features/tickets/components/TicketDetailPanel";
import { TicketStats, type TicketTotals } from "@/features/tickets/components/TicketStats";
import { TicketTable, type SortKey } from "@/features/tickets/components/TicketTable";
import { TicketToolbar } from "@/features/tickets/components/TicketToolbar";
import { assignableUsers } from "@/features/users/api";

/**
 * Tickets — the support queue, bound to Jira.
 *
 * The page is a two-pane board: the queue on the left (filters, one table, one pager) and
 * the selected ticket on the right, which is the only place a ticket is edited. Jira is the
 * tracker for this deployment, so the page never offers a destination choice — a ticket is
 * created in Jira, its status moves in Jira, and every write goes through the backend's
 * transition table rather than writing a local status nobody upstream knows about.
 *
 * Colours come from the design tokens (--primary, --accent-soft, --border, bg-card) so the
 * board holds up in both themes; the queue owns one border and the page owns the spacing.
 */

type Props = {
  role: string;
  userName?: string;
  onToast: (msg: string, kind?: "ok" | "err") => void;
};

const PAGE_SIZE = 10;

const emptyDraft = {
  subject: "",
  description: "",
  category: "General",
  priority: "medium",
  assignee: "",
  due_date: "",
};

export default function Tickets({ role, userName, onToast }: Props) {
  const canManage = role === "admin" || role === "agent";

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  const [selected, setSelected] = useState<Ticket | null>(null);

  const [comments, setComments] = useState<Comment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [assignable, setAssignable] = useState<Assignable[]>([]);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [newTicket, setNewTicket] = useState({ ...emptyDraft });
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([
    { key: "general", label: "General" },
  ]);

  const [syncBusy, setSyncBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [jiraReady, setJiraReady] = useState<boolean | null>(null);

  /* ---------------------------------------------------------------- loading */
  const loadTickets = (limit = 50) =>
    listTickets(limit)
      .then((d) => {
        setTicketsError(null);
        setTickets((d?.tickets ?? []) as Ticket[]);
        setSelected((cur) =>
          cur ? ((d?.tickets ?? []) as Ticket[]).find((t) => t.id === cur.id) ?? cur : cur,
        );
      })
      .catch((err) => {
        setTicketsError(err instanceof Error ? err.message : String(err));
        setTickets([]);
      });

  useEffect(() => {
    void loadTickets();
  }, []);

  useEffect(() => {
    assignableUsers()
      .then((d) => setAssignable(d?.users ?? []))
      .catch(() => {});
    listTicketDestinations()
      .then((ds) => setJiraReady(Boolean(ds.find((d) => d.key === "jira")?.configured)))
      .catch(() => setJiraReady(null));
    listActiveDomains()
      .then((ds) => {
        if (!ds.length) return;
        const hasGeneral = ds.some((x) => x.key === "general");
        setCategories([
          ...(hasGeneral ? [] : [{ key: "general", label: "General" }]),
          ...ds.map((x) => ({ key: x.key, label: x.label })),
        ]);
      })
      .catch(() => {});
  }, []);

  // Comments and attachments belong to the selected ticket; both reset when it changes so a
  // slow response for ticket A can never be painted under ticket B.
  useEffect(() => {
    setComments([]);
    setAttachments([]);
    if (!selected?.id) return;
    let live = true;
    ticketComments(selected.id)
      .then((d) => live && setComments((d?.comments ?? []) as Comment[]))
      .catch(() => {});
    ticketAttachments(selected.id)
      .then((d) => live && setAttachments((d?.attachments ?? []) as Attachment[]))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [selected?.id]);

  /* -------------------------------------------------------------- filtering */
  const filteredTickets = useMemo(() => {
    if (!tickets) return [];
    const q = query.trim().toLowerCase();
    return tickets.filter((t) => {
      const inQuery =
        !q ||
        [t.id, t.subject, t.category, t.requester, t.assignee ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q);
      const inStatus = statusFilter === "all" || t.status === statusFilter;
      const inPriority = priorityFilter === "all" || t.priority === priorityFilter;
      return inQuery && inStatus && inPriority;
    });
  }, [tickets, query, statusFilter, priorityFilter]);

  const sortedTickets = useMemo(() => {
    if (!sortKey) return filteredTickets;
    const dir = sortDir === "asc" ? 1 : -1;
    const prioRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusRank: Record<string, number> = { open: 0, pending: 1, resolved: 2, closed: 3 };
    return [...filteredTickets].sort((a, b) => {
      let r: number;
      if (sortKey === "priority") r = (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      else if (sortKey === "status") r = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
      else r = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
      return r * dir;
    });
  }, [filteredTickets, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sortedTickets.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sortedTickets.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedTickets, safePage],
  );

  // Each card counts the set it filters to — a card that says 4 and shows 3 rows is worse
  // than no card at all.
  const stats: TicketTotals = useMemo(() => {
    const list = tickets ?? [];
    return {
      total: list.length,
      open: list.filter((t) => t.status === "open").length,
      pending: list.filter((t) => t.status === "pending").length,
      resolved: list.filter((t) => t.status === "resolved").length,
      closed: list.filter((t) => t.status === "closed").length,
    };
  }, [tickets]);

  function resetFilters() {
    setQuery("");
    setStatusFilter("all");
    setPriorityFilter("all");
    setPage(1);
  }

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  /* --------------------------------------------------------------- writing */
  async function handleStatus(status: Ticket["status"]) {
    if (!selected || statusBusy) return;
    const previous = selected.status;
    setStatusBusy(status);
    setSelected({ ...selected, status });
    try {
      const res = await ticketUpdate(selected.id, { status });
      // The backend writes the local mirror first and then asks Jira best-effort, so a 200
      // is not proof the tracker moved. `jira_synced` is the only field that says so.
      const synced = (res as { jira_synced?: boolean })?.jira_synced !== false;
      setComments((prev) => [
        ...prev,
        {
          id: Date.now(),
          author: userName,
          body: synced ? `status → ${status}` : `status → ${status} (Jira sync failed)`,
          kind: "status",
          created_at: new Date().toISOString(),
        },
      ]);
      if (synced) onToast("Status updated in Jira");
      else onToast("Saved in the queue — Jira did not accept the transition", "err");
      void loadTickets();
    } catch {
      setSelected({ ...selected, status: previous });
      onToast("Jira rejected the transition — the status is unchanged", "err");
    } finally {
      setStatusBusy(null);
    }
  }

  async function handleSaveEdit(fields: {
    subject: string;
    description: string;
    assignee: string;
    due_date: string;
  }): Promise<boolean> {
    if (!selected) return false;
    try {
      await ticketUpdate(selected.id, {
        subject: fields.subject,
        description: fields.description,
        assignee: fields.assignee || null,
        due_date: fields.due_date || null,
      });
      setSelected({
        ...selected,
        subject: fields.subject,
        description: fields.description,
        assignee: fields.assignee || null,
        due_date: fields.due_date || null,
      });
      setComments((prev) => [
        ...prev,
        {
          id: Date.now(),
          author: userName,
          body: "subject / description / assignee / due date edited",
          kind: "edit",
          created_at: new Date().toISOString(),
        },
      ]);
      onToast("Ticket updated in Jira");
      void loadTickets();
      return true;
    } catch {
      onToast("Update failed — Jira did not accept the change", "err");
      return false;
    }
  }

  async function handleAddComment(body: string) {
    if (!selected || !body.trim()) return;
    try {
      const c = await ticketAddComment(selected.id, body.trim());
      setComments((prev) => [...prev, c as Comment]);
      onToast("Comment added");
    } catch {
      onToast("Comment failed", "err");
    }
  }

  async function handleAddAttachment(file: File) {
    if (!selected) return;
    try {
      await ticketAttachmentAdd(selected.id, file);
      const d = await ticketAttachments(selected.id);
      setAttachments((d?.attachments ?? []) as Attachment[]);
      onToast("Attachment added");
    } catch {
      onToast("Upload failed", "err");
    }
  }

  async function syncTickets() {
    setSyncBusy(true);
    try {
      const res = await syncJiraTickets();
      if (res.total === 0) {
        onToast("No tickets returned — check Jira in Settings → Integrations", "err");
        return;
      }
      onToast(`Synced ${res.total} tickets (${res.created} new, ${res.updated} updated)`);
      await loadTickets(100);
      setSelected(null);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Sync failed", "err");
    } finally {
      setSyncBusy(false);
    }
  }

  async function reconcileTickets() {
    setReconcileBusy(true);
    try {
      const res = await reconcileJiraTickets();
      if (res.unreachable > 0 && res.checked === res.unreachable) {
        onToast("Jira is unreachable — nothing was changed", "err");
        return;
      }
      onToast(
        res.missing
          ? `Checked ${res.checked}: ${res.missing} ticket${res.missing === 1 ? "" : "s"} deleted in Jira removed, ${res.updated} status${res.updated === 1 ? "" : "es"} updated`
          : `Checked ${res.checked}: everything matches Jira${res.updated ? ` (${res.updated} updated)` : ""}`,
      );
      await loadTickets(100);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Reconciliation failed", "err");
    } finally {
      setReconcileBusy(false);
    }
  }

  async function createTicket() {
    if (!newTicket.subject.trim()) {
      onToast("Ticket subject is required", "err");
      return;
    }
    setCreating(true);
    try {
      const created = await createTicketApi({
        subject: newTicket.subject,
        description: newTicket.description,
        domain: newTicket.category.toLowerCase(),
        priority: newTicket.priority,
        assignee: newTicket.assignee || null,
        due_date: newTicket.due_date || null,
        destination: "jira",
      });
      for (const f of pendingFiles) {
        try {
          await ticketAttachmentAdd(created.id, f);
        } catch {
          onToast(`Attachment failed: ${f.name}`, "err");
        }
      }
      setCreateOpen(false);
      setNewTicket({ ...emptyDraft });
      setPendingFiles([]);
      onToast("Ticket created in Jira");
      await loadTickets();
      // The refresh can land before the mirror has the new row (Jira is eventually
      // consistent); put the created ticket on top so the queue reflects the write.
      const fresh: Ticket = {
        id: created.id ?? "new",
        subject: created.subject ?? newTicket.subject,
        description: created.description ?? newTicket.description,
        status: (created.status ?? "open") as Ticket["status"],
        priority: created.priority ?? newTicket.priority,
        category: created.category ?? newTicket.category,
        requester: created.requester ?? userName ?? "you",
        assignee: created.assignee ?? (newTicket.assignee || null),
        due_date: created.due_date ?? (newTicket.due_date || null),
        created_at: created.created_at ?? new Date().toISOString(),
        updated_at: created.updated_at ?? new Date().toISOString(),
      };
      setTickets((prev) => [fresh, ...(prev ?? []).filter((t) => t.id !== fresh.id)]);
      setPage(1);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Ticket creation failed", "err");
    } finally {
      setCreating(false);
    }
  }

  /* --------------------------------------------------------------- exports */
  function ticketRows() {
    return filteredTickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      requester: t.requester,
      assignee: t.assignee || "Unassigned",
      created: t.created_at,
      updated: t.updated_at,
    }));
  }

  function csvCell(v: string) {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }

  function exportCsv() {
    const rows = ticketRows();
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const body = [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => csvCell(String((r as Record<string, unknown>)[h] ?? ""))).join(",")),
    ].join("\n");
    const blob = new Blob(["\ufeff" + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ticket-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onToast(`Report exported — ${rows.length} tickets`);
  }

  function printReport() {
    const rows = ticketRows();
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      onToast("Pop-up blocked — allow pop-ups to print", "err");
      return;
    }
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(`<!doctype html><html><head><title>Ticket Report</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:32px;color:#0f172a}
        h1{font-size:18px;margin:0 0 4px}
        .meta{font-size:12px;color:#64748b;margin-bottom:16px}
        table{border-collapse:collapse;width:100%;font-size:11px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
        th{background:#f1f5f9}
      </style></head><body>
      <h1>IT Help — Ticket Report</h1>
      <div class="meta">Generated ${new Date().toLocaleString()} · ${rows.length} tickets</div>
      <table><thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>Status</th>
      <th>Priority</th><th>Requester</th><th>Assignee</th><th>Created</th><th>Updated</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${esc(r.id)}</td><td>${esc(r.subject)}</td><td>${esc(r.category)}</td><td>${esc(r.status)}</td><td>${esc(r.priority)}</td><td>${esc(r.requester)}</td><td>${esc(r.assignee)}</td><td>${esc(r.created)}</td><td>${esc(r.updated)}</td></tr>`,
        )
        .join("")}</tbody></table>
      <script>window.onload=function(){window.print()}<\/script>
      </body></html>`);
    w.document.close();
  }

  /* ------------------------------------------------------------------ view */
  return (
    <PageShell>
      <PageHeader
        eyebrow="Service desk"
        breadcrumbs={["Workspace", "Support"]}
        icon={<TicketIcon className="size-5" />}
        badge={role === "admin" ? "Administrator" : undefined}
        title="Tickets"
        description="Every request is a Jira issue — triage here, resolve upstream."
        actions={
          <div className="flex items-center gap-2">
            {canManage && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  disabled={syncBusy}
                  onClick={syncTickets}
                  title="Import the latest issues from Jira"
                >
                  <RefreshCw className={`mr-2 size-3.5 ${syncBusy ? "animate-spin" : ""}`} />
                  {syncBusy ? "Syncing…" : "Sync Jira"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  disabled={reconcileBusy}
                  onClick={reconcileTickets}
                  title="Check every ticket against Jira: remove issues deleted there, adopt changed statuses"
                >
                  <RefreshCw className={`mr-2 size-3.5 ${reconcileBusy ? "animate-spin" : ""}`} />
                  {reconcileBusy ? "Reconciling…" : "Reconcile"}
                </Button>
              </>
            )}
            <Button size="sm" className="rounded-lg" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              Create ticket
            </Button>
          </div>
        }
      />

      <main className="space-y-4 pb-2">
        {/* The four figures span the page, as they do on Overview and Domains; only the
            queue and its detail pane share the row below. */}
        <TicketStats
          totals={stats}
          activeStatus={statusFilter}
          onPick={(next) => {
            setStatusFilter(next);
            setPage(1);
          }}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  Support requests
                  <span className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                    {filteredTickets.length}
                  </span>
                </h2>
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-0.5 text-2xs text-muted-foreground"
                >
                  {tickets === null
                    ? "Loading tickets…"
                    : ticketsError
                      ? "Could not load tickets"
                      : `${filteredTickets.length} matching tickets`}
                </p>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={printReport}
                  disabled={!filteredTickets.length}
                  className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                  title="Print report"
                >
                  <Printer className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setListBusy(true);
                    await loadTickets();
                    onToast("Ticket list refreshed");
                    setListBusy(false);
                  }}
                  disabled={listBusy}
                  className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                  title="Refresh list"
                >
                  <RefreshIcon className={`size-3.5 ${listBusy ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={!filteredTickets.length}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-[11px] font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
                  title="Export CSV"
                >
                  <Download className="size-3.5" />
                  Export
                </button>
              </div>
            </div>

            <TicketToolbar
              filters={{ query, status: statusFilter, priority: priorityFilter }}
              counts={{
                all: stats.total,
                open: stats.open,
                pending: stats.pending,
                resolved: stats.resolved,
                closed: stats.closed ?? 0,
              }}
              onChange={(patch) => {
                if (patch.query !== undefined) setQuery(patch.query);
                if (patch.status !== undefined) setStatusFilter(patch.status);
                if (patch.priority !== undefined) setPriorityFilter(patch.priority);
                setPage(1);
              }}
              onReset={resetFilters}
            />

            {tickets === null ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" />
                ))}
              </div>
            ) : ticketsError ? (
              <ErrorState
                title="Could not load tickets"
                detail={ticketsError}
                onRetry={() => {
                  setTickets(null);
                  void loadTickets();
                }}
              />
            ) : filteredTickets.length === 0 ? (
              <EmptyState
                icon={<Filter className="size-5" />}
                title={tickets.length === 0 ? "No tickets yet" : "No tickets found"}
                description={
                  tickets.length === 0
                    ? "Nothing has been synced from Jira yet. Use Sync Jira above, or check the integration in Settings → Integrations."
                    : "Try changing your search or filter criteria."
                }
                actionLabel={tickets.length === 0 ? undefined : "Clear filters"}
                onAction={tickets.length === 0 ? undefined : resetFilters}
              />
            ) : (
              <TicketTable
                rows={pageRows}
                total={filteredTickets.length}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                page={safePage}
                pageCount={pageCount}
                pageSize={PAGE_SIZE}
                onPage={setPage}
              />
            )}
          </section>

          {/* Below xl the panel is a bottom sheet, so the overlay is what closes it. */}
          {selected && (
            <div
              className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[1px] xl:hidden"
              onClick={() => setSelected(null)}
              aria-hidden
            />
          )}

          <TicketDetailPanel
          ticket={selected}
          canManage={canManage}
          comments={comments}
          attachments={attachments}
          assignable={assignable}
          statusBusy={statusBusy}
          jiraReady={jiraReady !== false}
          onClose={() => setSelected(null)}
          onStatus={handleStatus}
          onSaveEdit={handleSaveEdit}
          onAddComment={handleAddComment}
          onAddAttachment={handleAddAttachment}
          />
        </div>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>Create support ticket</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)]/50 px-3 py-2 text-[11px] text-[var(--accent-foreground)]">
              <TicketIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-semibold">Create in Jira</span>
                <span className="text-[var(--accent-foreground)]/80">
                  {" "}— there is no other destination; the issue is mirrored into this queue.
                </span>
                {jiraReady === false && (
                  <span className="mt-1 block font-medium">
                    Jira is not configured yet — set it up in Settings → Integrations first.
                  </span>
                )}
              </span>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium">Subject</span>
              <input
                value={newTicket.subject}
                onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
                placeholder="Briefly describe the issue"
                aria-label="Subject"
                className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
              />
            </label>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium">Description</span>
                <button
                  type="button"
                  disabled={drafting || !newTicket.subject.trim()}
                  onClick={async () => {
                    setDrafting(true);
                    try {
                      const data = await articleDraft(newTicket.subject, newTicket.category.toLowerCase());
                      if (data.draft) {
                        setNewTicket({ ...newTicket, description: data.draft });
                        onToast("AI draft generated");
                      } else {
                        onToast(data.detail || "Draft failed", "err");
                      }
                    } catch {
                      onToast("Draft failed", "err");
                    } finally {
                      setDrafting(false);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)] disabled:opacity-40"
                >
                  <Sparkles className="size-3" />
                  {drafting ? "Drafting…" : "AI assist"}
                </button>
              </div>
              <textarea
                rows={5}
                value={newTicket.description}
                onChange={(e) => setNewTicket({ ...newTicket, description: e.target.value })}
                placeholder="What happened, any error messages, the affected system, and what you already tried…"
                aria-label="Ticket description"
                className="w-full resize-none rounded-xl border border-[var(--border)] bg-background px-3 py-2.5 text-sm leading-6 outline-none focus:border-[var(--primary)] focus:ring-4 focus:ring-[var(--primary)]/10"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium">Category</span>
                <select
                  value={newTicket.category}
                  onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                  aria-label="Category"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.label}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium">Priority</span>
                <select
                  value={newTicket.priority}
                  onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
                  aria-label="Priority"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium">Assignee</span>
                <select
                  value={newTicket.assignee}
                  onChange={(e) => setNewTicket({ ...newTicket, assignee: e.target.value })}
                  aria-label="Assignee"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
                >
                  <option value="">Unassigned</option>
                  {assignable.map((u) => (
                    <option key={u.username} value={u.username}>
                      {u.username}
                      {u.role === "admin" ? " (admin)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium">Due date</span>
                <input
                  type="date"
                  value={newTicket.due_date}
                  onChange={(e) => setNewTicket({ ...newTicket, due_date: e.target.value })}
                  aria-label="Due date"
                  className="h-10 w-full rounded-xl border border-[var(--border)] bg-background px-3 text-sm outline-none"
                />
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-xs font-medium">Attachments</span>
              <input
                type="file"
                multiple
                onChange={(e) => setPendingFiles(Array.from(e.target.files ?? []))}
                className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-[var(--accent-foreground)]"
              />
              {pendingFiles.length > 0 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {pendingFiles.length} file{pendingFiles.length > 1 ? "s" : ""} ready — uploaded
                  after the ticket exists.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createTicket} disabled={creating}>
              <Plus className="mr-2 size-4" />
              {creating ? "Creating…" : "Create ticket"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
