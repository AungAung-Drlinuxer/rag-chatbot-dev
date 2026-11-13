import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, Loader2, Play, ShieldAlert } from "lucide-react";

import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

/**
 * Data retention for conversation history and the audit trail.
 *
 * Two independent windows, each either a fixed number of days or "keep forever". The
 * preview is computed by the same predicate the purge uses, so the numbers shown here are
 * what the button will actually remove — not an estimate.
 */
type Policy = { conversations_days: number | null; audit_days: number | null };
type Preview = { conversations: number; messages: number; audit: number; kept_pinned: number };

const OPTIONS = [
  { value: "30", label: "1 month" },
  { value: "90", label: "3 months" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "", label: "Keep forever" },
];

function toValue(days: number | null | undefined) {
  return days ? String(days) : "";
}

function fromValue(v: string): number | null {
  return v === "" ? null : Number(v);
}

export function DataRetentionSettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lastRun, setLastRun] = useState<{ at?: string; removed?: Record<string, number> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch(`${BASE}/api/settings/retention`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setPolicy(j.policy);
      setPreview(j.preview);
      setLastRun(j.last_run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the retention policy");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!policy) return;
    setSaving(true);
    setNotice(null);
    try {
      const r = await apiFetch(`${BASE}/api/settings/retention`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
      setPolicy(j.policy);
      setPreview(j.preview);
      setNotice({ ok: true, message: "Retention policy saved. The nightly job applies it at 04:30 UTC." });
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setNotice(null);
    try {
      const r = await apiFetch(`${BASE}/api/settings/retention/run?confirm=DELETE`, {
        method: "POST",
        headers: authHeaders(),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
      const rem = j.removed || {};
      setNotice({
        ok: true,
        message: `Removed ${rem.conversations ?? 0} conversations, ${rem.messages ?? 0} messages, ${rem.audit ?? 0} audit rows.`,
      });
      setConfirmText("");
      await load();
    } catch (e) {
      setNotice({ ok: false, message: e instanceof Error ? e.message : "Cleanup failed" });
    } finally {
      setRunning(false);
    }
  }

  const nothingToDelete = !preview || (preview.conversations === 0 && preview.audit === 0);

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-foreground">Conversation history</span>
          <span className="block text-2xs text-muted-foreground">
            Sessions and their messages. Pinned conversations are always kept.
          </span>
          <select
            value={toValue(policy?.conversations_days)}
            onChange={(e) => setPolicy((p) => ({ ...(p as Policy), conversations_days: fromValue(e.target.value) }))}
            aria-label="Conversation retention"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none focus:border-[var(--primary)]"
          >
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-xs font-medium text-foreground">Audit log</span>
          <span className="block text-2xs text-muted-foreground">
            Sign-ins, changes, tickets and answers. Deleting these removes the evidence trail.
          </span>
          <select
            value={toValue(policy?.audit_days)}
            onChange={(e) => setPolicy((p) => ({ ...(p as Policy), audit_days: fromValue(e.target.value) }))}
            aria-label="Audit log retention"
            className="h-9 w-full rounded-lg border border-[var(--border)] bg-background px-2 text-xs outline-none focus:border-[var(--primary)]"
          >
            {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-muted/30 p-3">
        <div className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Clock3 className="size-3" /> Next run would remove
        </div>
        {preview ? (
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
            <li><span className="font-semibold tabular-nums">{preview.conversations.toLocaleString()}</span> conversations</li>
            <li><span className="font-semibold tabular-nums">{preview.messages.toLocaleString()}</span> messages</li>
            <li><span className="font-semibold tabular-nums">{preview.audit.toLocaleString()}</span> audit rows</li>
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Calculating…</p>
        )}
        {preview && preview.kept_pinned > 0 && (
          <p className="mt-1.5 text-2xs text-muted-foreground">
            {preview.kept_pinned.toLocaleString()} pinned conversation{preview.kept_pinned === 1 ? "" : "s"} past the
            window will be kept.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !policy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="size-3 animate-spin" />} Save policy
        </button>
        <span className="text-2xs text-muted-foreground">
          Applied nightly at 04:30 UTC by the scheduler.
        </span>
      </div>

      <div className="rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3">
        <div className="flex items-center gap-1.5 text-2xs font-semibold text-[var(--danger)]">
          <ShieldAlert className="size-3.5" /> Run the cleanup now
        </div>
        <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
          Deletion is permanent — export a transcript first if it still matters. Type
          <code className="mx-1 rounded bg-[var(--muted)] px-1 font-mono">DELETE</code>
          to confirm.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
            className="h-8 w-28 rounded-lg border border-[var(--border)] bg-background px-2 font-mono text-xs uppercase outline-none focus:border-[var(--danger)]"
          />
          <button
            type="button"
            onClick={runNow}
            disabled={running || confirmText.trim().toUpperCase() !== "DELETE" || nothingToDelete}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--danger)]/40 px-3 py-1.5 text-2xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger)]/10 disabled:opacity-40"
            title={nothingToDelete ? "Nothing is past the window right now" : "Delete everything past the window"}
          >
            {running ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Delete expired data
          </button>
          {lastRun?.at && (
            <span className="text-2xs text-muted-foreground">
              Last run {new Date(lastRun.at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--warn)]" />
        Tickets are never deleted by retention; a ticket whose conversation is gone keeps its own
        record but loses the link back to the chat.
      </p>

      {notice && (
        <p role="status" className={`text-2xs ${notice.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
          {notice.message}
        </p>
      )}
    </div>
  );
}
