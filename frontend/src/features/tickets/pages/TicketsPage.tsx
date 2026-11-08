import {
  Download,
  Filter,
  Plus,
  Printer,
  RefreshCw,
  Ticket as TicketIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageHeader, PageShell } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listTicketDestinations,
  listTickets,
  syncJiraTickets,
  reconcileJiraTickets,
  ticketAddComment,
  deleteTicketAttachment,
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
import {
  TicketEditDialog,
  type TicketEditPayload,
} from "@/features/tickets/components/TicketEditDialog";
import { TicketStats, type TicketTotals } from "@/features/tickets/components/TicketStats";
import { TicketTable, type SortKey } from "@/features/tickets/components/TicketTable";
import { TicketToolbar } from "@/features/tickets/components/TicketToolbar";
import { assignableUsers } from "@/features/users/api";
import { ApprovalQueue } from "@/features/tickets/components/ApprovalQueue";
import { CreateTicketDialog } from "@/features/tickets/components/CreateTicketDialog";

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
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);

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
    // Jira's order, with `reopened` treated as the top of the queue (it needs attention again).
    const statusRank: Record<string, number> = {
      reopened: 0, open: 1, pending: 2, in_progress: 3, done: 4,
    };
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
      in_progress: list.filter((t) => t.status === "in_progress").length,
      done: list.filter((t) => t.status === "done").length,
      reopened: list.filter((t) => t.status === "reopened").length,
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
  async function handleStatus(status: Ticket["status"], comment = ""): Promise<boolean> {
    if (!selected || statusBusy) return false;
    const previous = selected.status;
    setStatusBusy(status);
    setSelected({ ...selected, status });
    try {
      // One request: the transition and the comment travel together, so an operator never has
      // to remember to add the explanation as a second step.
      const res = await ticketUpdate(selected.id, { status, ...(comment ? { comment } : {}) }) as {
        jira_synced?: boolean;
        comment_synced?: boolean | null;
      };
      const synced = res?.jira_synced !== false;
      const commentOk = res?.comment_synced !== false;
      const fresh = await ticketComments(selected.id).catch(() => null);
      if (fresh?.comments) setComments(fresh.comments as Comment[]);
      if (synced && commentOk) {
        onToast(comment ? "Updated in Jira with your comment" : "Status updated in Jira");
      } else if (!synced) {
        onToast("Saved in the queue — Jira did not accept the transition", "err");
      } else {
        onToast("Status updated, but Jira rejected the comment", "err");
      }
      void loadTickets();
      return synced;
    } catch (err) {
      setSelected({ ...selected, status: previous });
      const why = err instanceof Error ? err.message : "";
      onToast(
        why
          ? `Jira rejected the change — nothing was saved. ${why}`
          : "Jira rejected the change — nothing was saved",
        "err",
      );
      return false;
    } finally {
      setStatusBusy(null);
    }
  }

  /**
   * One save for the whole edit sheet.
   *
   * Order matters: the field/workflow PUT goes first because it is the only call Jira can
   * refuse with a reason (409). Attachments follow, since a file that lands on an issue whose
   * status never moved is confusing. Each failure is reported by name rather than as one
   * generic "save failed", so the operator knows what did and did not land.
   */
  async function handleSaveTicket(p: TicketEditPayload): Promise<boolean> {
    if (!selected) return false;
    setEditBusy(true);
    const target = selected;
    const problems: string[] = [];
    try {
      const res = await ticketUpdate(target.id, {
        subject: p.subject,
        description: p.description,
        priority: p.priority,
        assignee: p.assignee || null,
        due_date: p.due_date || null,
        ...(p.status ? { status: p.status } : {}),
        ...(p.comment ? { comment: p.comment } : {}),
      });
      if (res?.fields_synced === false) problems.push("Jira kept its own copy of the details");
      if (res?.comment_synced === false) problems.push("the note was not posted to Jira");

      for (const id of p.removeAttachments) {
        try {
          const out = await deleteTicketAttachment(target.id, id);
          if (out.jira_synced === false) problems.push(`“${out.filename}” is still on the issue`);
        } catch (e) {
          problems.push(e instanceof Error ? e.message : "an attachment could not be deleted");
        }
      }
      for (const f of p.addFiles) {
        try {
          await ticketAttachmentAdd(target.id, f);
        } catch (e) {
          problems.push(`“${f.name}” did not upload (${e instanceof Error ? e.message : "error"})`);
        }
      }

      const [fresh, freshComments] = await Promise.all([
        ticketAttachments(target.id).catch(() => ({ attachments: [] })),
        ticketComments(target.id).catch(() => ({ comments: [] })),
      ]);
      setAttachments((fresh?.attachments ?? []) as Attachment[]);
      setComments((freshComments?.comments ?? []) as Comment[]);
      setSelected({
        ...target,
        subject: p.subject,
        description: p.description,
        priority: p.priority as Ticket["priority"],
        assignee: p.assignee || null,
        due_date: p.due_date || null,
        ...(p.status ? { status: p.status as Ticket["status"] } : {}),
      });

      if (problems.length) onToast(`Saved, with ${problems.length} caveat(s): ${problems.join("; ")}`, "err");
      else onToast(p.status ? `Saved to Jira — moved to ${p.status.replace("_", " ")}` : "Saved to Jira");
      void loadTickets();
      setEditing(false);
      return true;
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Save failed — nothing was changed", "err");
      return false;
    } finally {
      setEditBusy(false);
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

  async function handleDeleteAttachment(id: number) {
    if (!selected) return;
    try {
      const out = await deleteTicketAttachment(selected.id, id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
      onToast(out.jira_synced === false ? "Removed here — Jira kept its copy" : "Attachment removed",
              out.jira_synced === false ? "err" : "ok");
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Delete failed", "err");
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
        {role === "admin" && <ApprovalQueue onToast={onToast} onDecided={() => void loadTickets()} />}
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
                in_progress: stats.in_progress,
                done: stats.done,
                reopened: stats.reopened,
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
          statusBusy={statusBusy}
          jiraReady={jiraReady !== false}
          onClose={() => setSelected(null)}
          onStatus={handleStatus}
          onEdit={() => setEditing(true)}
          onDeleteAttachment={handleDeleteAttachment}
          onAddComment={handleAddComment}
          onAddAttachment={handleAddAttachment}
          />

          <TicketEditDialog
            ticket={editing ? selected : null}
            assignable={assignable}
            attachments={attachments}
            jiraReady={jiraReady !== false}
            busy={editBusy}
            onClose={() => setEditing(false)}
            onSave={handleSaveTicket}
          />
        </div>
      </main>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onToast={onToast}
        onCreated={(created: any) => {
          // Jira is eventually consistent: the list refetch can land before the mirror has
          // the new row, so the created ticket goes on top immediately.
          const fresh: Ticket = {
            id: created?.id ?? "new",
            subject: created?.subject ?? "",
            description: created?.description ?? "",
            status: (created?.status ?? "open") as Ticket["status"],
            priority: created?.priority ?? "medium",
            category: created?.category ?? "General",
            requester: created?.requester ?? userName ?? "you",
            assignee: created?.assignee ?? null,
            due_date: created?.due_date ?? null,
            created_at: created?.created_at ?? new Date().toISOString(),
            updated_at: created?.updated_at ?? new Date().toISOString(),
          };
          // Refresh first, then prepend: the reverse order let the refetch replace the list
          // and drop the row we had just added.
          void loadTickets().then(() => {
            setTickets((prev) => [fresh, ...(prev ?? []).filter((t) => t.id !== fresh.id)]);
            setPage(1);
          });
        }}
      />

    </PageShell>
  );
}
