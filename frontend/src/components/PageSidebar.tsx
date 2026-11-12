/** Shared nav sidebar for non-chat pages (extracted verbatim from App.tsx).
 * Capability-aware nav: a menu entry the role cannot use is NOT rendered at all.
 * (It used to stay visible as a locked row that explained the denial on click — an
 * administrator's menu is what people expect to see, and a rail full of padlocks reads
 * as a broken app rather than a permission model.) The page-level guard in App.tsx
 * still answers a deep link or a bookmarked URL with the reason. */
import { useEffect, useState } from "react";
import { dateBucket, relativeAge } from "@/features/chat/model";
import { setPendingConversation } from "@/features/chat/pendingConversation";
import { conversationFromHash } from "@/app/router";
import { brandInitials, displayAppName, useBranding } from "@/app/useBranding";
import { BookOpen, ChevronDown, Layers, ChevronRight, Home, MessageSquare, MessagesSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, ScrollText, Settings as SettingsIcon, Ticket as TicketIcon, Trash2, Users as UsersIcon } from "lucide-react";
import { useNotifications, NotificationBell } from "@/components/NotificationBell";
import {
  listConversations,
  deleteConversation,
  clearConversations,
  renameConversation,
  pinConversation,
} from "@/features/conversations/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BUCKET_ORDER = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

/**
 * S1.3 — bucket conversations for the sidebar timeline.
 * Pinned chats always sit on top; the rest are grouped by the newest message date.
 * Bucket order is fixed (not insertion order) so the list never reshuffles weirdly.
 */
function groupConversations(list: any[]): [string, any[]][] {
  const buckets = new Map<string, any[]>();
  for (const c of list) {
    const key = c?.is_pinned ? "Pinned" : dateBucket(c?.last_at ?? c?.updated_at);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  return BUCKET_ORDER.filter((k) => buckets.has(k)).map((k) => [k, buckets.get(k)!] as [string, any[]]);
}

/**
 * #18 — asking the same question repeatedly creates several sessions with the same
 * title, which reads as duplicated rows. Tag repeats with a ×N count so the list is
 * honest about how many conversations share that title (nothing is merged or hidden).
 */
function duplicateCounts(list: any[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of list) {
    const k = (c?.title || "Untitled chat").trim().toLowerCase();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/* ============================================================
   PageSidebar — shared nav for non-chat pages (v0.13.0)
============================================================ */

export default function PageSidebar({
  active,
  onNavigate,
  userName,
  role,
  displayRole,
  perms,
  onLogout,
  collapsed = false,
  onToggleCollapsed,
}: {
  active: string;
  onNavigate: (nav: string) => void;
  userName?: string;
  role?: string;
  displayRole?: string;
  perms?: Record<string, boolean>;
  onLogout?: () => void;
  collapsed?: boolean;      // B-3: icon rail mode (Cmd/Ctrl+B)
  onToggleCollapsed?: () => void;
}) {
  const branding = useBranding();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [conversations, setConversations] = useState<any[]>([]);

  /* A refresh that restores a conversation from the URL must also mark it in the list. */
  const [activeSessionId, setActiveSessionId] = useState<string>(() => conversationFromHash() ?? "");

  // #18 — title → occurrence count, so repeats can be badged in the list.
  const _dupes = duplicateCounts(conversations);

  const loadHistory = () => {
    listConversations()
      .then((res: any) => setConversations(res?.conversations ?? []))
      .catch(() => setConversations([]));
  };

  useEffect(() => {
    loadHistory();
    const handleRefresh = (e?: any) => {
      loadHistory();
      if (e?.detail) {
        setActiveSessionId(e.detail);
      }
    };
    const handleOpen = (e: any) => {
      if (e?.detail) {
        setActiveSessionId(e.detail);
      }
    };
    window.addEventListener("ith:refresh-conversations", handleRefresh);
    window.addEventListener("ith:open-conversation", handleOpen);
    window.addEventListener("ith:new-chat-started", () => setActiveSessionId(""));
    return () => {
      window.removeEventListener("ith:refresh-conversations", handleRefresh);
      window.removeEventListener("ith:open-conversation", handleOpen);
      window.removeEventListener("ith:new-chat-started", () => setActiveSessionId(""));
    };
  }, []);
  /* Every role gets a feed now: the server scopes it to the caller (their own escalation
     decisions and tickets, plus the approval/LDAP queues for admins and agents). The old
     version turned polling off for plain users, so they never saw anything at all. */
  const { notices, error: noticesError, refresh: refreshNotices, clear: clearNotices } =
    useNotifications(role || "user", true);

  // Nav items are capability-aware and the menu is filtered, not greyed out: an entry
  // with a capability the caller lacks never reaches the DOM. While permissions are
  // still loading we show only the always-available entries, so nobody sees a menu item
  // appear and then vanish.
  const items: Array<{ id: string; label: string; icon: React.ReactNode; cap?: string; capLabel?: string }> = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="size-4" />, cap: "chatbot", capLabel: "Ask the AI assistant" },
    { id: "dashboard", label: "Overview", icon: <Home className="size-4" /> },
    { id: "articles", label: "Knowledge", icon: <BookOpen className="size-4" />, cap: "manage_kb", capLabel: "Manage the knowledge base & articles" },
    { id: "domains", label: "Domains & Routing", icon: <Layers className="size-4" />, cap: "manage_domains", capLabel: "Manage classification domains & Jira routing" },
    { id: "tickets", label: "Tickets", icon: <TicketIcon className="size-4" /> },
    { id: "users", label: "Users", icon: <UsersIcon className="size-4" />, cap: "manage_users", capLabel: "Manage users, roles & settings" },
    { id: "history", label: "Conversations", icon: <MessagesSquare className="size-4" />, cap: "manage_users", capLabel: "Review organization conversation history" },
    { id: "audits", label: "Audit Log", icon: <ScrollText className="size-4" />, cap: "manage_users", capLabel: "View platform audit trail" },
    { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
  ];
  // STRICT: a capped entry renders only when the caller's permissions say so. Anything
  // else — undefined while /api/me is in flight, or an empty object on a cold start —
  // renders nothing rather than rendering it and then removing it one second later. The
  // capability list is cached with the session, so a refresh's first paint is already
  // correct.
  // `chatbot` is held by every role, so Chat does not need to wait for /api/me — that
  // only made it pop in a moment after the rest of the menu.
  const visible = items.filter((item) =>
    !item.cap || item.cap === "chatbot" || perms?.[item.cap] === true);

  const pretty = displayRole || ({ admin: "Administrator", knowledge: "Knowledge Manager", domain_manager: "Knowledge Manager" } as Record<string, string>)[role || "user"] || "User";

  const navBody = (
    <>
      {collapsed ? (
        /* Rail mode: top brand avatar or expand button */
        <div className="flex flex-col items-center justify-center gap-2 border-b border-white/15 dark:border-[var(--sidebar-border)] py-3">
          {branding.logo ? (
            <img src={branding.logo} alt="Logo" className="size-8 rounded-xl object-contain" />
          ) : (
            <div className="grid size-8 place-items-center overflow-hidden rounded-xl bg-white text-xs font-extrabold text-violet-700 shadow-sm dark:bg-[var(--primary)] dark:text-white">
              {branding.logo ? (
                <img src={branding.logo} alt="" className="size-full object-contain p-1" />
              ) : (
                brandInitials(branding.appName)
              )}
            </div>
          )}
          {onToggleCollapsed && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              title="Expand sidebar (Ctrl+B)"
              aria-label="Expand sidebar"
              className="mt-1 rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition"
            >
              <PanelLeftOpen className="size-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="flex h-16 items-center justify-between border-b border-white/15 dark:border-[var(--sidebar-border)] px-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {branding.logo ? (
              <img src={branding.logo} alt="Company logo" className="size-8 shrink-0 rounded-xl object-contain" />
            ) : (
              <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-xl bg-white text-xs font-extrabold text-violet-700 shadow-sm dark:bg-[var(--primary)] dark:text-white">
                {branding.logo ? (
                  <img src={branding.logo} alt="" className="size-full object-contain p-1" />
                ) : (
                  brandInitials(branding.appName)
                )}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{displayAppName(branding.appName)}</div>
            </div>
          </div>

          <div className="hidden items-center gap-1 shrink-0 lg:flex">
            <NotificationBell
              notices={notices}
              error={noticesError}
              onRetry={refreshNotices}
              onClear={clearNotices}
              collapsed={collapsed}
              onOpen={onNavigate}
            />
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="Collapse sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
                className="rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white transition"
              >
                <PanelLeftClose className="size-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* v1.0.1 — "New Chat" from the reference mockup. It dispatches the same
          `ith:new-chat` event the Chat nav item fires, so there is one definition of
          "start over" rather than a second code path that could drift from it. Hidden
          when collapsed: an icon-only button would be indistinguishable from the nav
          items beside it. */}
      {!collapsed && (
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={() => {
              onNavigate("chat");
              window.dispatchEvent(new CustomEvent("ith:new-chat"));
              setMobileOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-3 py-2.5 text-xs font-semibold text-violet-700 shadow-sm transition hover:bg-violet-50 dark:bg-[var(--primary)] dark:text-white dark:hover:bg-violet-500"
          >
            <Plus className="size-3.5" />
            New conversation
          </button>
        </div>
      )}

      <nav className={"min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-3 " + (collapsed ? "px-2" : "px-3")}>
        {!collapsed && (
          <p data-section className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white/55 dark:text-[var(--sidebar-text-muted)]">
            Workspace
          </p>
        )}
        {visible.map((item) => {
          return (
            <div key={item.id}>
              <button
                onClick={() => {
                  onNavigate(item.id);
                  if (item.id === "chat") {
                    window.dispatchEvent(new CustomEvent("ith:new-chat"));
                  }
                  setMobileOpen(false);
                }}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={[
                  "mb-1 flex w-full items-center rounded-lg text-left text-xs font-medium transition",
                  collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
                  active === item.id
                    ? "bg-white text-violet-700 font-semibold shadow-sm dark:bg-[var(--sidebar-active-bg)] dark:text-white"
                    : "text-white/80 hover:bg-white/10 hover:text-white",
                ].join(" ")}
              >
                {item.icon}
                {!collapsed && <span className="flex-1">{item.label}</span>}
                {active === item.id && (
                  <span className="ml-auto size-1.5 shrink-0 rounded-full bg-violet-500" aria-hidden="true" />
                )}
              </button>
            </div>
          );
        })}

        {/* Recent Chat History in Sidebar */}
        {!collapsed && (
          <div className="mt-4 pt-3 border-t border-white/15 dark:border-[var(--sidebar-border)]">
            <div data-section className="flex items-center justify-between px-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 dark:text-[var(--sidebar-text-muted)]">
              <button
                type="button"
                onClick={() => setHistoryOpen(!historyOpen)}
                className="flex items-center gap-1.5 tracking-[0.14em] hover:text-white transition"
              >
                <span>History</span>
                <span className="text-2xs text-white/50 font-normal dark:text-[var(--sidebar-text-muted)]">({conversations.length})</span>
                {historyOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
              {conversations.length > 0 && (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (window.confirm("Are you sure you want to delete all chat history? This cannot be undone.")) {
                      try {
                        await clearConversations();
                        loadHistory();
                        setActiveSessionId("");
                        window.dispatchEvent(new CustomEvent("ith:new-chat"));
                      } catch {
                        // ignore error
                      }
                    }
                  }}
                  className="rounded p-1 text-white/60 hover:text-rose-200 hover:bg-white/10 transition"
                  title="Delete all history"
                  aria-label="Delete all history"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            {historyOpen && (
              <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto pr-1">

                {conversations.length === 0 ? (
                  <p className="px-2 py-2 text-2xs text-white/55 italic">No recent chats</p>
                ) : (
                  /* S1.3 — date grouping (Newest-first buckets) so a long history
                     reads as a timeline instead of one flat list of near-identical
                     question strings. */
                  groupConversations(conversations).map(([bucket, items]) => (
                    <div key={bucket} className="pb-1">
                      <div className="sticky top-0 z-10 px-2 pb-1 pt-1.5 text-3xs font-semibold uppercase tracking-wide text-white/55">
                        {bucket}
                      </div>
                      {items.map((c) => {
                    const isSelected = activeSessionId === c.session_id;
                    return (
                    <div key={c.session_id} className="group relative flex items-center">
                      <button
                        type="button"
                        onClick={() => {
                          /* Park the id first: navigating mounts the chat page, and an event
                             fired before its listener exists is lost — which is why a row used
                             to need a second click. */
                          setPendingConversation(c.session_id);
                          onNavigate("chat");
                          setActiveSessionId(c.session_id);
                          window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: c.session_id }));
                          setMobileOpen(false);
                        }}
                        className={[
                          "flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs transition",
                          isSelected
                            ? "bg-white/20 font-semibold text-white dark:bg-[var(--sidebar-active-bg)]"
                            : "text-white/70 hover:bg-white/10 hover:text-white",
                        ].join(" ")}
                        title={c.title || "Untitled chat"}
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {c.is_pinned && <Pin className="size-3 shrink-0 text-violet-200 rotate-45" />}
                          <span className="truncate">{c.title || "Untitled chat"}</span>
                          {(_dupes.get((c.title || "Untitled chat").trim().toLowerCase()) ?? 1) > 1 && (
                            <span
                              className="shrink-0 rounded bg-white/20 px-1 text-3xs font-semibold text-white/85"
                              title="Sessions with this same title"
                            >
                              ×{_dupes.get((c.title || "Untitled chat").trim().toLowerCase())}
                            </span>
                          )}
                          {/* The mockup puts a terse age on every row; it is what lets the
                              eye skip a bucket it does not care about. */}
                          <span
                            className="ml-auto shrink-0 pl-1.5 text-2xs tabular-nums text-white/50 group-hover:text-white/75"
                            title={c.last_at || c.updated_at || ""}
                          >
                            {relativeAge(c.last_at ?? c.updated_at)}
                          </span>
                        </span>
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-white/60 hover:text-white transition"
                            title="Actions"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={() => {
                              pinConversation(c.session_id, !c.is_pinned).then(loadHistory);
                            }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Pin className="size-3.5" />
                            {c.is_pinned ? "Unpin" : "Pin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              const newT = window.prompt("Rename chat:", c.title || "");
                              if (newT && newT.trim()) {
                                renameConversation(c.session_id, newT.trim()).then(loadHistory);
                              }
                            }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <Pencil className="size-3.5" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (window.confirm("Delete this conversation?")) {
                                deleteConversation(c.session_id).then(loadHistory);
                              }
                            }}
                            className="flex items-center gap-2 text-xs text-rose-500 focus:text-rose-500"
                          >
                            <Trash2 className="size-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </nav>
      <div className={"shrink-0 border-t border-white/15 dark:border-[var(--sidebar-border)] py-4 " + (collapsed ? "px-2" : "px-4")}>
        <div className={"flex " + (collapsed ? "flex-col items-center gap-2" : "flex-col gap-2.5")}>
          <div className="flex w-full min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-semibold text-white dark:bg-[var(--primary)]" title={collapsed ? (userName ?? "User") + " · " + pretty : undefined}>
              {(userName?.charAt(0) ?? "A").toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-white" title={userName ?? "User"}>{userName ?? "User"}</div>
                <span className={["mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold", "bg-white/20 text-white/90 dark:bg-[var(--sidebar-active-bg)] dark:text-white"].join(" ")}>
                  {pretty}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => onLogout?.()}
            title="Sign out"
            className={"flex items-center justify-center rounded-lg border border-white/30 text-2xs font-medium text-white/80 transition hover:border-red-300 hover:bg-red-500/10 hover:text-red-200 " + (collapsed ? "p-2" : "w-full gap-1.5 px-2.5 py-2")}
          >
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            {!collapsed && "Sign out"}
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--background)] px-4 lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="grid size-10 place-items-center rounded-lg hover:bg-muted"
          aria-label="Open navigation"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center overflow-hidden rounded-lg bg-violet-600 text-2xs font-bold text-white">
            {branding.logo ? (
              <img src={branding.logo} alt="" className="size-full object-contain p-1" />
            ) : (
              brandInitials(branding.appName)
            )}
          </div>
          <span className="text-xs font-semibold">IT Help</span>
        </div>
        {/* Reachable without opening the drawer — it was only inside the sidebar, which on
            a phone is off-canvas until you know to tap the menu. */}
        <NotificationBell
          notices={notices}
          error={noticesError}
          onRetry={refreshNotices}
          onClear={clearNotices}
          onOpen={onNavigate}
        />
      </div>
      {/* Spacer for fixed top bar on mobile */}
      <div className="h-14 lg:hidden" />

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-gradient-to-b from-violet-700 to-violet-900 transition-all border-violet-800/60 dark:bg-none dark:bg-[var(--sidebar-bg)] dark:border-[var(--sidebar-border)] lg:static lg:z-auto lg:translate-x-0 " + (collapsed ? "w-[72px]" : "w-[256px]"),
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {navBody}
      </aside>
    </>
  );
}
