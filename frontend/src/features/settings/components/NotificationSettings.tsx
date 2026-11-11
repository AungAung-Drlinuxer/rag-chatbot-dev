/**
 * Notification preferences — what the bell is allowed to tell you, and a way to clear it.
 *
 * These are server-side preferences (user_settings.prefs), not browser flags: the feed is
 * derived per user on the server, so switching "Ticket updates" off here has to change what
 * `/api/notifications` returns. Only the chime stays local, because sound is a property of
 * this device, not of the account.
 *
 * Each switch saves on its own (like the theme picker): a settings page where a toggle only
 * takes effect after pressing a Save button at the bottom is the bug this page already had.
 */
import { useEffect, useState } from "react";
import { BellOff, Check, Loader2, Trash2 } from "lucide-react";
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

const SOUND_KEY = "ith:notif-muted";

type Switch = {
  key: "notifyApprovals" | "notifyTickets" | "notifyAccounts";
  title: string;
  hint: string;
  adminOnly?: boolean;
};

const SWITCHES: Switch[] = [
  {
    key: "notifyApprovals",
    title: "Approval requests",
    hint: "Escalations waiting for a person to approve or reject.",
  },
  {
    key: "notifyTickets",
    title: "Ticket updates",
    hint: "Your escalations that were decided, and the Jira tickets created from them.",
  },
  {
    key: "notifyAccounts",
    title: "Account approvals",
    hint: "New accounts held at the LDAP gate until an administrator approves them.",
    adminOnly: true,
  },
];

export default function NotificationSettings({ isAdmin }: { isAdmin: boolean }) {
  const [values, setValues] = useState<Record<string, boolean>>({
    notifyApprovals: true,
    notifyTickets: true,
    notifyAccounts: true,
  });
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch(`${BASE}/api/settings`, { headers: authHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!alive) return;
        setValues((prev) => {
          const next = { ...prev };
          for (const s of SWITCHES) {
            if (typeof d?.[s.key] === "boolean") next[s.key] = d[s.key];
          }
          return next;
        });
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load notification settings");
      } finally {
        if (alive) {
          setLoaded(true);
          try {
            setSound(localStorage.getItem(SOUND_KEY) !== "1");
          } catch {
            setSound(true);
          }
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  async function toggle(key: string, next: boolean) {
    setValues((v) => ({ ...v, [key]: next }));
    setBusy(key);
    setError(null);
    try {
      const r = await apiFetch(`${BASE}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ [key]: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      // Put the switch back: a toggle that lies about being saved is worse than a slow one.
      setValues((v) => ({ ...v, [key]: !next }));
      setError(e instanceof Error ? e.message : "Could not save that preference");
    } finally {
      setBusy(null);
    }
  }

  function toggleSound(next: boolean) {
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "0" : "1");
    } catch {
      /* storage disabled — the chime simply stays on for this session */
    }
  }

  async function clearAll() {
    setClearing(true);
    setError(null);
    setCleared(null);
    try {
      const r = await apiFetch(`${BASE}/api/notifications/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setCleared(typeof d?.cleared === "number" ? d.cleared : 0);
      window.dispatchEvent(new CustomEvent("ith:notifications-cleared"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear notifications");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {SWITCHES.filter((s) => !s.adminOnly || isAdmin).map((s) => (
        <div key={s.key} className="flex items-start justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{s.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={values[s.key]}
            aria-label={s.title}
            disabled={!loaded || busy === s.key}
            onClick={() => void toggle(s.key, !values[s.key])}
            className={[
              "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
              values[s.key]
                ? "border-[var(--primary)] bg-[var(--primary)]"
                : "border-[var(--border)] bg-[var(--muted)]",
              !loaded ? "opacity-50" : "",
            ].join(" ")}
          >
            <span
              className={[
                "grid size-5 place-items-center rounded-full bg-white text-[10px] shadow transition",
                values[s.key] ? "translate-x-[22px]" : "translate-x-[2px]",
              ].join(" ")}
            >
              {busy === s.key ? <Loader2 className="size-3 animate-spin text-slate-500" /> : null}
            </span>
          </button>
        </div>
      ))}

      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Play a sound</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A short chime when a new notification arrives, on this device only.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={sound}
          aria-label="Play a sound"
          onClick={() => toggleSound(!sound)}
          className={[
            "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
            sound ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)] bg-[var(--muted)]",
          ].join(" ")}
        >
          <span
            className={[
              "size-5 rounded-full bg-white shadow transition",
              sound ? "translate-x-[22px]" : "translate-x-[2px]",
            ].join(" ")}
          />
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Clear notifications</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dismisses everything currently in the bell for your account. The underlying
            approvals and tickets are not deleted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void clearAll()}
          disabled={clearing}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 text-xs font-semibold text-foreground transition hover:bg-[var(--muted)] disabled:opacity-50"
        >
          {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          Clear all
        </button>
      </div>

      {cleared !== null && (
        <div className="flex items-center gap-1.5 px-5 py-3 text-xs text-[var(--ok)]">
          <Check className="size-3.5" />
          Cleared {cleared} notification{cleared === 1 ? "" : "s"} — they will not come back.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 px-5 py-3 text-xs text-[var(--danger)]">
          <BellOff className="size-3.5" />
          {error}
        </div>
      )}
    </div>
  );
}
