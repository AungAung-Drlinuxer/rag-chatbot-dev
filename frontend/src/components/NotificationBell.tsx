/**
 * Notification bell — the one place the shell tells an operator something needs a decision.
 *
 * It polls the two queues that actually block work:
 *   * pending HITL approvals (`/api/approvals`), which hold a ticket until someone decides,
 *   * LDAP-gated accounts waiting for approval (`/api/users`, status "Pending").
 *
 * Behaviour that used to be missing and is now explicit:
 *   * the badge counts UNREAD notices (ids not yet seen on this browser), not "everything
 *     that exists", so a permanent queue does not look like a new alert forever,
 *   * a short chime plays when a new notice arrives (mutable, remembered per browser),
 *   * the list refreshes on window focus as well as on the timer, because an operator
 *     usually comes back to the tab right after acting in Jira,
 *   * opening the list marks what is shown as read; "Mark all read" clears the badge without
 *     dismissing the underlying queue (the approvals are still pending, the bell just stops
 *     shouting about them).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, Volume2, VolumeX } from "lucide-react";
import { listApprovals } from "@/features/chat/api";
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type Notice = {
  id: string;
  kind: "approval" | "ldap" | "monitoring" | "info";
  label: string;
  sub?: string;
};

const SEEN_KEY = "ith:notif-seen";
const MUTED_KEY = "ith:notif-muted";
const POLL_MS = 15_000;

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function writeSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-200)));
  } catch {
    /* storage disabled — the badge simply behaves as "everything is new" */
  }
}

/** A two-note chime, synthesised so the shell ships no audio asset. */
export function playChime(volume = 0.06) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(volume, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.24);
    });
    window.setTimeout(() => void ctx.close().catch(() => {}), 800);
  } catch {
    /* audio blocked (no gesture yet / autoplay policy) — silence is the correct fallback */
  }
}

export function useNotifications(role: string, enabled: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    async function poll() {
      const out: Notice[] = [];
      try {
        const d = await listApprovals();
        const pending = (d.approvals ?? []).filter((a: { status?: string }) => a.status === "pending");
        for (const a of pending.slice(0, 5)) {
          out.push({
            id: "ap-" + a.id,
            kind: "approval",
            label: a.question || "Ticket approval requested",
            sub: "HITL approval",
          });
        }
      } catch {
        /* approval endpoint refused or offline — not fatal for the shell */
      }
      if (role === "admin" || role === "agent") {
        try {
          const r = await apiFetch(`${BASE}/api/users`, { headers: authHeaders() });
          if (r.ok) {
            const d = await r.json();
            const pending = (d.users ?? []).filter(
              (u: { status?: string }) => (u.status || "").toLowerCase() === "pending",
            );
            for (const u of pending.slice(0, 5)) {
              out.push({ id: "ldap-" + u.username, kind: "ldap", label: `${u.username} awaiting approval`, sub: "LDAP gate" });
            }
          }
        } catch {
          /* non-fatal */
        }
      }
      if (alive) setNotices(out);
    }

    void poll();
    const iv = window.setInterval(poll, POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [enabled, role]);

  return notices;
}

export function NotificationBell({
  notices,
  collapsed,
  onOpen,
}: {
  notices: Notice[];
  collapsed?: boolean;
  onOpen?: (nav: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());
  const [muted, setMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MUTED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const firstRun = useRef(true);
  // Session-only: what we have already rung about. `seen` is the persisted *read* set.
  const alerted = useRef<Set<string>>(new Set());

  const unread = useMemo(() => notices.filter((n) => !seen.has(n.id)), [notices, seen]);

  const markRead = useCallback((ids: string[]) => {
    setSeen((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      writeSeen([...next]);
      return next;
    });
  }, []);

  // Chime once per genuinely new id. The first poll is a silent baseline: work that was
  // already waiting when the tab opened is shown in the badge (it is still unread) but must
  // not ring as if it just arrived.
  useEffect(() => {
    if (notices.length === 0) return;
    const fresh = notices.filter((n) => !alerted.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => alerted.current.add(n.id));
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!muted) playChime();
  }, [notices, muted]);

  function toggleMute() {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(MUTED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const badge = unread.length;

  const trigger = (
    <button
      type="button"
      title={badge ? `${badge} unread notification${badge === 1 ? "" : "s"}` : "Notifications"}
      aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
      aria-expanded={open}
      onClick={() => {
        setOpen((v) => !v);
        if (!open) markRead(notices.map((n) => n.id));
      }}
      className="relative rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
    >
      <Bell className="size-4" />
      {badge > 0 && (
        <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-[var(--danger)] text-3xs font-bold text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );

  const panel = open && (
    <div
      role="menu"
      className={[
        "z-[60] w-72 rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl",
        collapsed ? "absolute left-full top-0 ml-2" : "absolute right-0 top-full mt-1",
      ].join(" ")}
    >
      <div className="flex items-center justify-between px-2 pb-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Notifications</span>
        <button
          type="button"
          onClick={toggleMute}
          aria-pressed={muted}
          aria-label={muted ? "Turn notification sound on" : "Turn notification sound off"}
          title={muted ? "Sound off" : "Sound on"}
          className="rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
        </button>
      </div>

      {notices.length === 0 ? (
        <div className="flex items-center justify-center gap-1.5 px-3 py-6 text-center text-xs text-muted-foreground">
          <Check aria-hidden className="size-3.5 text-[var(--ok)]" />
          You&apos;re all caught up
        </div>
      ) : (
        <NoticeList notices={notices} unreadIds={new Set(unread.map((n) => n.id))} onOpen={onOpen} onClose={() => setOpen(false)} onRead={markRead} />
      )}
    </div>
  );

  if (collapsed) {
    return (
      <div className="relative flex justify-center py-1">
        {trigger}
        {panel}
      </div>
    );
  }

  return (
    <div className="relative">
      {trigger}
      {panel}
    </div>
  );
}

function NoticeList({
  notices,
  unreadIds,
  onOpen,
  onClose,
  onRead,
}: {
  notices: Notice[];
  unreadIds: Set<string>;
  onOpen?: (nav: string) => void;
  onClose: () => void;
  onRead: (ids: string[]) => void;
}) {
  const go = (n: Notice) => {
    onRead([n.id]);
    onClose();
    if (n.kind === "approval") onOpen?.("tickets");
    else if (n.kind === "ldap") onOpen?.("users");
    else if (n.kind === "monitoring") onOpen?.("dashboard");
  };
  return (
    <>
      {notices.map((n) => (
        <button
          key={n.id}
          role="menuitem"
          onClick={() => go(n)}
          className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-muted"
        >
          <span
            aria-hidden
            className={[
              "mt-1 size-1.5 shrink-0 rounded-full",
              n.kind === "approval" ? "bg-[var(--warn)]" : n.kind === "monitoring" ? "bg-[var(--danger)]" : "bg-[var(--primary)]",
              unreadIds.has(n.id) ? "" : "opacity-30",
            ].join(" ")}
          />
          <span className="min-w-0 flex-1">
            <span className={["block truncate text-xs", unreadIds.has(n.id) ? "font-semibold" : "font-medium"].join(" ")}>
              {n.label}
            </span>
            <span className="block text-2xs text-muted-foreground">{n.sub}</span>
          </span>
        </button>
      ))}
    </>
  );
}
