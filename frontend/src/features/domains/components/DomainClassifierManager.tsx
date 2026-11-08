/**
 * Domain list manager.
 *
 * The manager owns three things only: the list, which domain is being edited, and the
 * delete confirmation. Creating and updating live in `DomainFormSheet`, which is the
 * single place that knows how a domain is described and validated.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Plus } from "lucide-react";

import { ClassifierDomainItem, deleteClassifierDomain } from "@/features/domains/api";
import { DomainFormSheet, type DomainFormMode } from "@/features/domains/components/DomainFormSheet";
import { DomainRoutingItem } from "@/features/domains/components/DomainRoutingItem";
import { DomainAssigneesDialog } from "@/features/domains/components/DomainAssigneesDialog";

// Presentation metadata lives in one place; re-exported for older imports.
export { ICON_OPTIONS, COLOR_OPTIONS } from "@/features/domains/components/domainMeta";

interface Props {
  domains: ClassifierDomainItem[];
  onRefresh: () => void;
  canManage: boolean;
  /** The page owns the panel chrome, so the manager can render just the list. */
  hideHeader?: boolean;
  /** Bump this number to open the create sheet from the page header. */
  openCreateSignal?: number;
}

export function DomainClassifierManager({
  domains,
  onRefresh,
  canManage,
  hideHeader = false,
  openCreateSignal = 0,
}: Props) {
  const [sheet, setSheet] = useState<{ mode: DomainFormMode; domain: ClassifierDomainItem | null } | null>(null);
  const [deleting, setDeleting] = useState<ClassifierDomainItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assigneesFor, setAssigneesFor] = useState<ClassifierDomainItem | null>(null);
  const [notice, setNotice] = useState<{ msg: string; tone: "ok" | "err" } | null>(null);

  useEffect(() => {
    if (openCreateSignal > 0) setSheet({ mode: "create", domain: null });
  }, [openCreateSignal]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteClassifierDomain(deleting.id);
      setDeleting(null);
      onRefresh();
    } catch (err: any) {
      setDeleteError(err?.message || "Could not delete this domain.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-4 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold">Routing domains</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {domains.length} domain{domains.length === 1 ? "" : "s"} configured
            </p>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setSheet({ mode: "create", domain: null })}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-medium text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90"
            >
              <Plus className="size-3.5" aria-hidden /> Add domain
            </button>
          )}
        </div>
      )}

      <div className="divide-y divide-[var(--border)]">
        {domains.map((d) => (
          <DomainRoutingItem
            key={d.id}
            domain={d}
            canManage={canManage}
            onEdit={(domain) => setSheet({ mode: "edit", domain })}
            onAssignees={(domain) => setAssigneesFor(domain)}
            onDelete={(domain) => { setDeleting(domain); setDeleteError(null); }}
          />
        ))}
      </div>

      {notice && (
        <p
          role="status"
          className={[
            "px-4 pb-2 text-2xs sm:px-5",
            notice.tone === "err" ? "text-[var(--danger)]" : "text-muted-foreground",
          ].join(" ")}
        >
          {notice.msg}
        </p>
      )}

      <DomainAssigneesDialog
        domain={assigneesFor}
        onClose={() => setAssigneesFor(null)}
        onToast={(msg, tone = "ok") => setNotice({ msg, tone })}
      />

      <DomainFormSheet
        open={sheet !== null}
        mode={sheet?.mode ?? "create"}
        domain={sheet?.domain ?? null}
        onClose={() => setSheet(null)}
        onSaved={onRefresh}
      />

      {/* Delete stays a separate, explicit confirmation — no destructive action inside the
          edit sheet, where it would sit one mis-click away from "Save changes". */}
      {deleting && (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${deleting.display_name}`}
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setDeleting(null); }}
        >
          <div className="my-auto w-full max-w-sm rounded-2xl border border-[var(--border)] bg-card p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--danger)]/10 text-[var(--danger)]">
                <AlertCircle className="size-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Delete “{deleting.display_name}”?</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  The routing rule is removed. Articles already stored under{" "}
                  <code className="font-mono">{deleting.domain_key}</code> keep their label until
                  they are re-saved or re-ingested.
                </p>
              </div>
            </div>

            {deleteError && (
              <p className="mt-3 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-2.5 py-2 text-2xs text-[var(--danger)]" role="alert">
                {deleteError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleting(null)}
                className="h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={confirmDelete}
                className="h-9 rounded-lg bg-[var(--danger)] px-3 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Delete domain"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
