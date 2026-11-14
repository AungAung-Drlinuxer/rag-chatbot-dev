import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock3, DatabaseZap, Loader2, Play, Save, ShieldAlert } from "lucide-react";

import { BASE, apiFetch, authHeaders } from "@/shared/api/client";
import { BTN_DANGER, BTN_PRIMARY, INPUT_MONO, Panel, Row, SectionProblem, SectionSkeleton } from "./SettingsKit";

/**
 * Data retention for conversation history and the audit trail.
 *
 * Every window shows three numbers, because "0 to remove" alone is unreadable: how much is
 * stored, how much sits past the window, and how much the job would keep because it is
 * pinned. The preview is computed by the same predicate the purge uses, so it cannot
 * promise one thing and delete another.
 *
 * Layout follows SettingsKit (`Panel` + `Row`, control on the right) — the same vocabulary
 * as Preferences / AI service, so this page does not invent a second design language.
 */
type Policy = { conversations_days: number | null; audit_days: number | null };
type Counts = { conversations: number; messages: number; audit: number };
type Preview = Counts & { kept_pinned: number };

const OPTIONS = [
  { value: "30", label: "1 month" },
  { value: "90", label: "3 months" },
  { value: "180", label: "6 months" },
  { value: "365", label: "1 year" },
  { value: "", label: "Keep forever" },
];

const toValue = (d: number | null | undefined) => (d ? String(d) : "");
const fromValue = (v: string) => (v === "" ? null : Number(v));
const n = (v: number | undefined) => (v ?? 0).toLocaleString();

function Select({ value, onChange, label }: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 w-[148px] rounded-xl border border-[var(--border)] bg-background px-2.5 text-xs text-foreground outline-none transition focus:border-[var(--primary)]"
    >
      {OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function DataRetentionSettings() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [totals, setTotals] = useState<Counts | null>(null);
  const [oldest, setOldest] = useState<{ conversations?: string | null; audit?: string | null }>({});
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
      setTotals(j.totals);
      setOldest(j.oldest ?? {});
      setLastRun(j.last_run);
      setError(null);
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
      setTotals(j.totals);
      setNotice({ ok: true, message: "Saved. The nightly job applies this at 04:30 UTC." });
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
        message: `Removed ${n(rem.conversations)} conversations, ${n(rem.messages)} messages, ${n(rem.audit)} audit rows.`,
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
  const convTail = preview
    ? `${n(preview.conversations)} conversations past the window${
        preview.kept_pinned > 0 ? ` · ${n(preview.kept_pinned)} pinned kept` : ""
      }`
    : "Calculating…";

  /* No policy yet means the fetch has not answered: show the shape of the page, not a
     "Keep forever" default that would look like the stored policy. */
  if (policy === null) {
    return error
      ? <SectionProblem title="Could not load the retention policy" detail={error} onRetry={() => void load()} />
      : <SectionSkeleton rows={3} label="Loading the retention policy" />;
  }
  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <Panel
        icon={<Clock3 className="size-4" />}
        title="Retention windows"
        description="How long each history is kept. The nightly job removes anything older at 04:30 UTC."
      >
        <Row
          title="Conversation history"
          hint={`Stored ${n(totals?.conversations)} conversations · ${n(totals?.messages)} messages${
            oldest.conversations ? ` · oldest ${new Date(oldest.conversations).toLocaleDateString()}` : ""
          } — ${convTail}`}
        >
          <Select
            label="Conversation retention"
            value={toValue(policy?.conversations_days)}
            onChange={(v) => setPolicy((p) => ({ ...(p as Policy), conversations_days: fromValue(v) }))}
          />
        </Row>

        <Row
          title="Audit log"
          hint={`Stored ${n(totals?.audit)} rows${
            oldest.audit ? ` · oldest ${new Date(oldest.audit).toLocaleDateString()}` : ""
          } — ${preview ? `${n(preview.audit)} past the window` : "Calculating…"}`}
        >
          <Select
            label="Audit log retention"
            value={toValue(policy?.audit_days)}
            onChange={(v) => setPolicy((p) => ({ ...(p as Policy), audit_days: fromValue(v) }))}
          />
        </Row>

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-muted/20 px-5 py-3">
          <button type="button" onClick={save} disabled={saving || !policy} className={BTN_PRIMARY}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save policy
          </button>
          <span className="text-2xs text-muted-foreground">
            Next run removes {n(preview?.conversations)} conversations, {n(preview?.messages)} messages,
            {" "}{n(preview?.audit)} audit rows.
          </span>
        </div>
      </Panel>

      <Panel
        icon={<DatabaseZap className="size-4" />}
        title="Delete expired data now"
        description="The same deletion the nightly job performs, run on demand. Permanent — export a transcript first if it still matters."
      >
        <Row title="Confirm deletion" hint="Type DELETE to enable the button. Pinned conversations are never deleted.">
          <div className="flex items-center gap-2">
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              aria-label="Type DELETE to confirm"
              className={INPUT_MONO + " w-[110px] uppercase"}
            />
            <button
              type="button"
              onClick={runNow}
              disabled={running || confirmText.trim().toUpperCase() !== "DELETE" || nothingToDelete}
              className={BTN_DANGER}
              title={nothingToDelete ? "Nothing is past the window right now" : "Delete everything past the window"}
            >
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              Delete expired data
            </button>
          </div>
        </Row>
        {lastRun?.at && (
          <p className="border-t border-[var(--border)] px-5 py-2.5 text-2xs text-muted-foreground">
            Last run {new Date(lastRun.at).toLocaleString()}
            {lastRun.removed
              ? ` — removed ${n(lastRun.removed.conversations)} conversations, ${n(lastRun.removed.messages)} messages, ${n(lastRun.removed.audit)} audit rows`
              : ""}
          </p>
        )}
      </Panel>

      <p className="flex items-start gap-1.5 px-1 text-2xs leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[var(--warn)]" />
        Tickets are never deleted by retention; a ticket whose conversation is gone keeps its own record
        but loses the link back to the chat.
      </p>

      {notice && (
        <p role="status" className={`flex items-center gap-1.5 px-1 text-2xs ${notice.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
          <ShieldAlert className="size-3" /> {notice.message}
        </p>
      )}
    </div>
  );
}
