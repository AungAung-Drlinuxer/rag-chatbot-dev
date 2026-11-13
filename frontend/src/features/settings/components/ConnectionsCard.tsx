import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, ListOrdered, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

import {
  createConnection,
  deleteConnection,
  listConnections,
  reorderConnections,
  testConnection,
  updateConnection,
  type Connection,
} from "@/features/settings/api";
import { IntegrationLogo } from "./IntegrationLogo";

/**
 * Sites for one provider.
 *
 * A token belongs to exactly one Atlassian site, so an estate with its own Confluence and
 * an HQ one needs two rows here — not two fields in one form. Each row owns its URL, its
 * account and its spaces, and can be tested on its own, which is the only way to tell
 * "HQ is down" apart from "the knowledge base is empty".
 */
export function ConnectionsCard({ provider }: { provider: "confluence" | "jira" }) {
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [editing, setEditing] = useState<Connection | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  /* Add-site takes as many rows as you need: an estate often has several Jira projects or
     Confluence sites to enter in one sitting, and one modal per site turns that into a chore. */
  const [extra, setExtra] = useState<Record<string, string>[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [ordering, setOrdering] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await listConnections(provider);
      setRows(res.connections ?? []);
    } catch {
      setRows([]);
    }
  }, [provider]);

  useEffect(() => { void load(); }, [load]);

  const blankRow = useCallback(
    (sequence: number): Record<string, string> =>
      provider === "confluence"
        ? { label: "", base_url: "", email: "", api_token: "", cloud_id: "", spaces: "", sequence: String(sequence) }
        : { label: "", base_url: "", email: "", api_token: "", project_key: "", sequence: String(sequence) },
    [provider],
  );

  function addRow() {
    setExtra((rows_) => [...rows_, blankRow((rows?.length ?? 0) + rows_.length + 2)]);
  }

  function dropRow(index: number) {
    setExtra((rows_) => rows_.filter((_, i) => i !== index));
  }

  function startNew() {
    setEditing("new");
    setExtra([]);
    setForm(blankRow((rows?.length ?? 0) + 1));
    setNotice(null);
  }

  function startEdit(c: Connection) {
    setEditing(c);
    setExtra([]);
    setForm({
      label: c.label, base_url: c.base_url, email: c.email,
      api_token: "", cloud_id: c.cloud_id,
      spaces: (c.spaces || []).join(", "), project_key: c.project_key,
      sequence: String(c.sequence ?? 1),
    });
    setNotice(null);
  }

  function payloadOf(row: Record<string, string>): Record<string, unknown> {
    return {
      provider,
      label: row.label?.trim() ?? "",
      base_url: row.base_url?.trim() ?? "",
      email: row.email ?? "",
      cloud_id: row.cloud_id ?? "",
      project_key: row.project_key ?? "",
      api_token: row.api_token || undefined,
      spaces: provider === "confluence"
        ? (row.spaces || "").split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      sequence: row.sequence ? Number(row.sequence) : undefined,
    };
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      if (editing === "new") {
        /* Every row with a label and a URL is written; a half-filled row is simply skipped
           rather than failing the whole batch. */
        const queue = [form, ...extra].filter((r) => r.label?.trim() && r.base_url?.trim());
        const failed: string[] = [];
        for (const row of queue) {
          try {
            await createConnection(payloadOf(row) as never);
          } catch (e) {
            failed.push(`${row.label}: ${e instanceof Error ? e.message : "failed"}`);
          }
        }
        const added = queue.length - failed.length;
        /* Anything that failed stays in the form so it can be corrected, not retyped. */
        const leftovers = extra.filter((r) => failed.some((f) => f.startsWith(`${r.label}:`)));
        setExtra(leftovers);
        if (added > 0 && !failed.length) setEditing(null);
        setNotice(
          failed.length
            ? { ok: false, message: `${added} added, ${failed.length} failed — ${failed.join("; ")}` }
            : { ok: true, message: `${added} site${added === 1 ? "" : "s"} added. Sites sync on the next Knowledge sync.` },
        );
      } else if (editing) {
        await updateConnection(editing.id, payloadOf(form) as never);
        setEditing(null);
        setExtra([]);
        setNotice({ ok: true, message: "Saved. Sites sync on the next Knowledge sync." });
      }
      await load();
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Move one site one step up or down and renumber the provider 1..n.
   * The list is written as a whole, so the numbers can never end up duplicated.
   */
  async function move(c: Connection, dir: -1 | 1) {
    if (!rows || ordering) return;
    const current = [...rows].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
    const at = current.findIndex((r) => r.id === c.id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= current.length) return;
    const next = [...current];
    [next[at], next[to]] = [next[to], next[at]];
    setRows(next.map((r, i) => ({ ...r, sequence: i + 1 })));
    setOrdering(true);
    try {
      const res = await reorderConnections(provider, next.map((r) => r.id));
      if (res.connections) setRows(res.connections);
      setNotice({ ok: true, message: "Sequence saved." });
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Could not save the order" });
      await load();
    } finally {
      setOrdering(false);
    }
  }

  async function probe(c: Connection) {
    setBusyId(c.id);
    setNotice(null);
    try {
      const res = await testConnection(c.id);
      setNotice({
        ok: res.ok,
        message: res.ok ? `${c.label}: connected${res.detail ? ` — ${res.detail}` : ""}` : `${c.label}: ${res.detail || "failed"}`,
      });
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(c: Connection) {
    if (!window.confirm(`Remove the ${c.label} site? Articles already synced stay in the knowledge base.`)) return;
    setBusyId(c.id);
    try {
      await deleteConnection(c.id, c.label);
      await load();
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Could not remove" });
    } finally {
      setBusyId(null);
    }
  }

  const isConf = provider === "confluence";
  const sequenceLabel = isConf ? "Confluence sequence" : "Jira sequence";
  const ordered = rows ? [...rows].sort((a, b) => a.sequence - b.sequence || a.id - b.id) : [];

  return (
    <section className="rounded-xl border border-[var(--border)] bg-muted/20 p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <IntegrationLogo providerKey={provider} name={provider} size="sm" className="size-4" />
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {isConf ? "Confluence sites" : "Jira sites"}
        </h4>
        <span className="text-2xs text-muted-foreground/70">
          one row per site — tokens never cross sites
        </span>
        <button
          type="button"
          onClick={startNew}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-card px-2.5 py-1 text-2xs font-semibold transition hover:bg-muted"
        >
          <Plus className="size-3" /> Add site
        </button>
      </div>

      {/* Sequence: which site the assistant reads first, and which one syncs first. The order
          is the list order, so the strip doubles as a summary of what the numbers mean. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-[var(--border)] bg-background/60 px-2.5 py-1.5">
        <span className="inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListOrdered className="size-3" />
          {sequenceLabel}
        </span>
        {ordered.length === 0 ? (
          <span className="text-2xs text-muted-foreground/80">no site to order yet</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1">
            {ordered.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-card px-1.5 py-0.5 text-2xs">
                <span className="grid size-4 place-items-center rounded-full bg-[var(--primary)] text-[10px] font-bold text-[var(--primary-foreground)]">
                  {c.sequence}
                </span>
                <span className="max-w-[9rem] truncate">{c.label}</span>
              </span>
            ))}
          </span>
        )}
        <span className="text-2xs text-muted-foreground/70">
          1 is read and synced first — use the arrows on a row to change it
        </span>
        {ordering && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>

      {rows === null ? (
        <p className="text-2xs text-muted-foreground">Loading sites…</p>
      ) : rows.length === 0 ? (
        <p className="text-2xs text-muted-foreground">
          No site configured yet — the fields below still work as the single default site.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((c, idx) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5">
              <span
                className="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--primary)]/15 text-[10px] font-bold text-[var(--accent-foreground)]"
                title={`${sequenceLabel}: ${c.sequence}`}
              >
                {c.sequence}
              </span>
              <span className="flex flex-col">
                <button type="button" onClick={() => move(c, -1)} disabled={idx === 0 || ordering}
                  aria-label={`Move ${c.label} earlier`}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-25">
                  <ChevronUp className="size-3" />
                </button>
                <button type="button" onClick={() => move(c, 1)} disabled={idx === ordered.length - 1 || ordering}
                  aria-label={`Move ${c.label} later`}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-25">
                  <ChevronDown className="size-3" />
                </button>
              </span>
              <span className="text-xs font-semibold text-foreground">{c.label}</span>
              <span className="truncate text-2xs text-muted-foreground" title={c.base_url}>{c.base_url}</span>
              {isConf && c.spaces.length > 0 && (
                <span className="rounded border border-[var(--border)] px-1 font-mono text-2xs text-muted-foreground">
                  {c.spaces.join(" · ")}
                </span>
              )}
              {!isConf && c.project_key && (
                <span className="rounded border border-[var(--border)] px-1 font-mono text-2xs text-muted-foreground">
                  {c.project_key}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 text-2xs ${c.token_set ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>
                {c.token_set ? <CheckCircle2 className="size-3" /> : null}
                {c.token_set ? "token set" : "no token"}
              </span>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => probe(c)} disabled={busyId === c.id}
                  className="rounded-md border border-[var(--border)] px-2 py-1 text-2xs font-medium transition hover:bg-muted disabled:opacity-50">
                  {busyId === c.id ? <Loader2 className="size-3 animate-spin" /> : "Test"}
                </button>
                <button type="button" onClick={() => startEdit(c)} aria-label={`Edit ${c.label}`}
                  className="rounded-md border border-[var(--border)] p-1 transition hover:bg-muted">
                  <Pencil className="size-3" />
                </button>
                <button type="button" onClick={() => remove(c)} aria-label={`Remove ${c.label}`}
                  className="rounded-md border border-[var(--danger)]/40 p-1 text-[var(--danger)] transition hover:bg-[var(--danger)]/10">
                  <Trash2 className="size-3" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p role="status" className={`mt-2 text-2xs ${notice.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
          {notice.message}
        </p>
      )}

      {editing && (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-background p-3">
          <div className="mb-2 flex items-center gap-2">
            <h5 className="text-xs font-semibold">{editing === "new" ? "Add a site" : `Edit ${editing.label}`}</h5>
            <button type="button" onClick={() => setEditing(null)} aria-label="Cancel"
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted">
              <X className="size-3.5" />
            </button>
          </div>
          {/* One block for the first site, then one per "Add another" row: the same six fields
              repeated is what an estate with several projects actually needs to type. */}
          {[form, ...extra].map((row, idx) => (
            <div
              key={idx}
              className={`grid grid-cols-1 gap-2 md:grid-cols-2 ${idx > 0 ? "mt-2.5 rounded-lg border border-dashed border-[var(--border)] p-2.5" : ""}`}
            >
              {idx > 0 && (
                <div className="flex items-center gap-2 md:col-span-2">
                  <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Site {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => dropRow(idx - 1)}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-2xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3" /> Remove
                  </button>
                </div>
              )}
              {[
                { k: "label", l: "Label", ph: isConf ? "HQ Confluence" : "HQ Jira" },
                { k: "base_url", l: "Base URL", ph: "https://hq.atlassian.net/wiki" },
                { k: "email", l: "Account email", ph: "svc-account@corp.com" },
                { k: "api_token", l: "API token", ph: editing === "new" ? "ATATT3x…" : "leave blank to keep current", secret: true },
                ...(isConf
                  ? [
                      { k: "spaces", l: "Space keys (comma separated)", ph: "IHKB, HELP, IT" },
                      { k: "cloud_id", l: "Cloud ID (optional)", ph: "b7f1…" },
                    ]
                  : [{ k: "project_key", l: "Default project key", ph: "ITHD" }]),
                { k: "sequence", l: `${isConf ? "Confluence" : "Jira"} sequence`, ph: "1" },
              ].map((f) => (
                <label key={f.k} className="space-y-1 text-2xs">
                  <span className="font-medium text-foreground">{f.l}</span>
                  <input
                    type={f.secret ? "password" : f.k === "sequence" ? "number" : "text"}
                    min={f.k === "sequence" ? 1 : undefined}
                    max={f.k === "sequence" ? 999 : undefined}
                    value={row[f.k] || ""}
                    onChange={(e) => {
                      const next = { ...row, [f.k]: e.target.value };
                      if (idx === 0) setForm(next);
                      else setExtra((list) => list.map((r, i) => (i === idx - 1 ? next : r)));
                    }}
                    placeholder={f.ph}
                    autoComplete="off"
                    className="w-full rounded-lg border border-[var(--border)] bg-background px-2.5 py-1.5 text-xs outline-none focus:border-[var(--primary)]"
                  />
                </label>
              ))}
            </div>
          ))}

          {editing === "new" && (
            <button
              type="button"
              onClick={addRow}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-dashed border-[var(--border)] px-2.5 py-1 text-2xs font-medium text-muted-foreground transition hover:border-[var(--primary)] hover:text-foreground"
            >
              <Plus className="size-3" /> Add another site
            </button>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <button type="button" onClick={save} disabled={saving || !form.label?.trim() || !form.base_url?.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
              {saving && <Loader2 className="size-3 animate-spin" />}
              {editing === "new" && extra.length > 0 ? `Save ${1 + extra.length} sites` : "Save site"}
            </button>
            <button type="button" onClick={() => setEditing(null)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-2xs font-medium hover:bg-muted">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
