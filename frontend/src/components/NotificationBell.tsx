/** B-6 — notification bell: polls admin-relevant events (pending HITL approvals,
 *  LDAP-pending accounts) and shows an unread dot + dropdown list. Shell-level
 *  (PageSidebar head), capability-filtered to manage_users/admin visibility. */
import { useEffect, useState } from "react";
import { Bell,
  Check,
} from "lucide-react";
import { listApprovals } from "@/features/chat/api";
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export type Notice = { id: string; kind: "approval" | "ldap" | "monitoring" | "info"; label: string; sub?: string };

export function useNotifications(role: string, enabled: boolean) {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    async function poll() {
      const out: Notice[] = [];
      try {
        const d = await listApprovals();
        const pending = (d.approvals ?? []).filter((a: any) => a.status === "pending");
        for (const a of pending.slice(0, 5)) {
          out.push({ id: "ap-" + a.id, kind: "approval", label: a.question || "Ticket approval requested", sub: "HITL approval" });
        }
      } catch { /* non-fatal */ }
      if (role === "admin" || role === "agent") {
        // GET /api/users returns AD+local users with status "Pending" for LDAP-gated accounts
        try {
          const r = await apiFetch(`${BASE}/api/users`, { headers: authHeaders() });
          if (r.ok) {
            const d = await r.json();
            const pending = (d.users ?? []).filter((u: any) => (u.status || "").toLowerCase() === "pending");
            for (const u of pending.slice(0, 5)) {
              out.push({ id: "ldap-" + u.username, kind: "ldap", label: `${u.username} awaiting approval`, sub: "LDAP gate" });
            }
          }
        } catch { /* non-fatal */ }
      }
      if (alive) setNotices(out);
    }
    poll();
    const iv = setInterval(poll, 30000);
    return () => { alive = false; clearInterval(iv); };
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
  if (collapsed) {
    return (
      <div className="relative flex justify-center py-1">
        <button
          type="button"
          title={notices.length ? `${notices.length} notifications` : "No notifications"}
          aria-label={"Notifications" + (notices.length ? `, ${notices.length} unread` : "")}
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Bell className="size-4" />
          {notices.length > 0 && (
            <span className="absolute right-1.5 top-1 size-2 rounded-full bg-red-500 ring-2 ring-[var(--sidebar-bg)]" />
          )}
        </button>
        {open && notices.length > 0 && (
          <div className="absolute left-full top-0 z-50 ml-2 w-72 rounded-xl border bg-[var(--card)] p-2 shadow-xl dark:border-slate-700">
            <NoticeList notices={notices} onOpen={onOpen} onClose={() => setOpen(false)} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <button
        type="button"
        title={notices.length ? `${notices.length} notifications` : "No notifications"}
        aria-label={"Notifications" + (notices.length ? `, ${notices.length} unread` : "")}
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <Bell className="size-4" />
        {notices.length > 0 && (
          <>
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-500" />
            <span className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-red-500 text-3xs font-bold text-white">
              {notices.length > 9 ? "9+" : notices.length}
            </span>
          </>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[60] mt-1 w-72 rounded-xl border bg-[var(--card)] p-2 shadow-xl dark:border-slate-700">
          {notices.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 px-3 py-6 text-center text-xs text-muted-foreground">
                          <Check aria-hidden className="size-3.5 text-emerald-500" />
                          You&apos;re all caught up
                        </div>
          ) : (
            <NoticeList notices={notices} onOpen={onOpen} onClose={() => setOpen(false)} />
          )}
        </div>
      )}
    </div>
  );
}

function NoticeList({ notices, onOpen, onClose }: { notices: Notice[]; onOpen?: (nav: string) => void; onClose: () => void }) {
  const go = (n: Notice) => {
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
          onClick={() => go(n)}
          className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <span className={"mt-1 size-1.5 shrink-0 rounded-full " + (n.kind === "approval" ? "bg-amber-500" : n.kind === "monitoring" ? "bg-red-500" : "bg-sky-500")} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-medium">{n.label}</span>
            <span className="block text-2xs text-muted-foreground">{n.sub}</span>
          </span>
        </button>
      ))}
    </>
  );
}
