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
import { createPortal } from "react-dom";
import { AlertTriangle, Bell, Check, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type Notice = {
  id: string;
  kind: "approval" | "ldap" | "monitoring" | "info";
  label: string;
  sub?: string;
  /** Where clicking it should go. Decided by the server, not guessed from `kind`. */
  nav?: string;
};

const SEEN_KEY = "ith:notif-seen";
const MUTED_KEY = "ith:notif-muted";
const POLL_MS = 15_000;
const MAX_POLL_MS = 60_000;

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

export function useNotifications(_role: string, enabled: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /* One feed, one request. The old version polled /api/approvals + /api/users from the
     browser for admins only, and swallowed every failure — so a 429 or an expired token
     rendered as "You're all caught up". Now a failure is a state the UI can show. */
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | undefined;
    let delay = POLL_MS;

    const stop = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    async function tick() {
      stop();
      if (!document.hidden) {
        try {
          const r = await apiFetch(`${BASE}/api/notifications`, { headers: authHeaders() });
          if (!r.ok) throw new Error(r.status === 429 ? "Too many requests" : `HTTP ${r.status}`);
          const d = await r.json();
          if (!alive) return;
          setNotices(Array.isArray(d?.notifications) ? d.notifications : []);
          setError(null);
          delay = POLL_MS;
        } catch (err) {
          if (!alive) return;
          setError(err instanceof Error ? err.message : "Notifications unavailable");
          // Back off: a failing endpoint must not be hammered every 15 seconds.
          delay = Math.min(delay * 2, MAX_POLL_MS);
        }
      }
      if (alive) timer = window.setTimeout(tick, delay);
    }

    const wake = () => {
      if (document.hidden) return;
      stop();
      delay = POLL_MS;
      void tick();
    };

    void tick();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive = false;
      stop();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [enabled, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  return { notices, error, refresh };
}


const PANEL_MAX_W = 320;
const PANEL_MARGIN = 8;

export type PanelBox = { top: number; left: number; width: number; maxHeight: number };

/** Where the panel goes: centred under the bell, then clamped into the viewport.
 *
 * The old CSS (`right-0` in the sidebar, `left-full` in the collapsed rail) put the panel
 * against an edge or entirely outside the screen — on a phone it was half cut off. Pure
 * geometry so it can be tested without a layout engine.
 */
export function computePanelPosition(
  anchor: { left: number; width: number; bottom: number },
  viewportW: number,
  viewportH: number,
  preferredWidth = PANEL_MAX_W,
): PanelBox {
  const width = Math.max(160, Math.min(preferredWidth, viewportW - PANEL_MARGIN * 2));
  const centred = anchor.left + anchor.width / 2 - width / 2;
  const left = Math.max(PANEL_MARGIN, Math.min(centred, viewportW - width - PANEL_MARGIN));
  // Prefer opening below the bell, but on a short screen (or a bell near the bottom) lift
  // the panel so its 240px body still fits — clamping the height alone pushed it off-screen.
  const top = Math.max(PANEL_MARGIN, Math.min(anchor.bottom + 6, viewportH - 240 - PANEL_MARGIN));
  const maxHeight = Math.max(160, viewportH - top - PANEL_MARGIN * 2);
  return { top: Math.round(top), left: Math.round(left), width: Math.round(width), maxHeight: Math.round(maxHeight) };
}

export function NotificationBell({
  notices,
  error,
  onRetry,
  collapsed,
  onOpen,
}: {
  notices: Notice[];
  /** Last poll failed. The list may be stale — never claim "all caught up" in that case. */
  error?: string | null;
  onRetry?: () => void;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<PanelBox | null>(null);

  // Place the panel from the bell's real rect: fixed positioning keeps it inside the
  // viewport even when the sidebar is a narrow rail or the window is 360px wide.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      setBox(computePanelPosition(
        { left: r.left, width: r.width, bottom: r.bottom },
        window.innerWidth,
        window.innerHeight,
      ));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Close on outside click / Escape: the panel used to stay until the bell was hit again,
  // which on a phone covered the conversation.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const trigger = (
    <button
      ref={triggerRef}
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

  const panel = open && createPortal((
    <div
      ref={panelRef}
      role="menu"
      style={box ? { position: "fixed", top: box.top, left: box.left, width: box.width, maxHeight: box.maxHeight } : { visibility: "hidden" }}
      className="z-[60] overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl"
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

      {notices.length === 0 && error ? (
        /* Unknown is not the same as empty. Saying "caught up" while the feed is broken is
           how a pending approval goes unnoticed all afternoon. */
        <div role="alert" className="mx-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Couldn&apos;t load notifications</p>
              <p className="mt-0.5 break-words text-2xs opacity-80">{error}</p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-2xs font-semibold hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
            >
              <RefreshCw aria-hidden className="size-3" /> Retry
            </button>
          )}
        </div>
      ) : notices.length === 0 ? (
        <div className="flex items-center justify-center gap-1.5 px-3 py-6 text-center text-xs text-muted-foreground">
          <Check aria-hidden className="size-3.5 text-[var(--ok)]" />
          You&apos;re all caught up
        </div>
      ) : (
        <>
          {error && (
            <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md bg-[var(--muted)] px-2 py-1 text-2xs text-muted-foreground">
              <AlertTriangle aria-hidden className="size-3 text-[var(--warn)]" />
              Couldn&apos;t refresh — showing the last known list
            </div>
          )}
          <NoticeList notices={notices} unreadIds={new Set(unread.map((n) => n.id))} onOpen={onOpen} onClose={() => setOpen(false)} onRead={markRead} />
        </>
      )}
    </div>
  ), document.body);

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
    if (n.nav) onOpen?.(n.nav);
    else if (n.kind === "approval") onOpen?.("tickets");
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
