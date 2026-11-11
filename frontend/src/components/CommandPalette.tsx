/** Command palette (B-4) — shell-level Cmd/Ctrl+K across pages, conversations, KB.
 *  Fetches conversations + KB article titles on open; arrow-key navigable.
 *  onNavigate(id) for pages · onOpenConversation(id) for chats · links for KB. */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Home, Layers, MessageSquare, MessagesSquare, ScrollText,
  Search, Settings as SettingsIcon, Ticket as TicketIcon, Users as UsersIcon,
} from "lucide-react";

export type PalettePage = { id: string; label: string; icon: string; enabled?: boolean };

type Conv = { session_id: string; title?: string | null; last_at?: string | null };
type Article = { title?: string; source_url?: string };

export default function CommandPalette({
  open,
  onClose,
  onNavigate,
  onOpenConversation,
  enabled,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (nav: string) => void;
  onOpenConversation: (sessionId: string) => void;
  enabled: Record<string, boolean>;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ(""); setIdx(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    import("@/features/conversations/api").then(({ listConversations }) =>
      listConversations()
        .then((d: any) => setConvs(Array.isArray(d?.conversations) ? d.conversations : []))
        .catch(() => setConvs([])),
    );
    import("@/features/knowledge/api").then(({ searchArticles }) =>
      searchArticles("").then((d: any) => setArticles((d?.articles ?? []).slice(0, 8))).catch(() => setArticles([])),
    );
  }, [open]);

  const pages = useMemo(
    () => [
      { id: "chat", label: "Chat", icon: <MessageSquare className="size-4" />, cap: "chatbot" },
      { id: "dashboard", label: "Overview", icon: <Home className="size-4" /> },
      { id: "articles", label: "Knowledge", icon: <BookOpen className="size-4" />, cap: "kb_search" },
      { id: "tickets", label: "Tickets", icon: <TicketIcon className="size-4" /> },
      { id: "domains", label: "Domains", icon: <Layers className="size-4" />, cap: "manage_domains" },
      { id: "users", label: "Users", icon: <UsersIcon className="size-4" />, cap: "manage_users" },
      { id: "history", label: "Conversations", icon: <MessagesSquare className="size-4" />, cap: "manage_users" },
      { id: "audits", label: "Audit Log", icon: <ScrollText className="size-4" />, cap: "manage_users" },
      { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" /> },
    ].filter((p) => !p.cap || enabled[p.cap] !== false),
    [enabled],
  );

  type Row =
    | { kind: "page"; id: string; label: string; icon: JSX.Element }
    | { kind: "conv"; id: string; label: string; when?: string | null }
    | { kind: "article"; label: string; url?: string };

  const results = useMemo<Row[]>(() => {
    const needle = q.trim().toLowerCase();
    const match = (s?: string | null) => !needle || (s ?? "").toLowerCase().includes(needle);
    const out: Row[] = [];
    pages.filter((p) => match(p.label)).forEach((p) => out.push({ kind: "page", id: p.id, label: p.label, icon: p.icon }));
    convs.filter((c) => match(c.title) || match(c.session_id)).slice(0, 6)
      .forEach((c) => out.push({ kind: "conv", id: c.session_id, label: c.title || "New conversation", when: c.last_at }));
    articles.filter((a) => match(a.title)).slice(0, 4)
      .forEach((a) => out.push({ kind: "article", label: a.title || "Untitled", url: a.source_url }));
    return out;
  }, [q, pages, convs, articles]);

  useEffect(() => setIdx(0), [q]);

  if (!open) return null;

  const activate = (r: Row) => {
    onClose();
    if (r.kind === "page") onNavigate(r.id);
    else if (r.kind === "conv") onOpenConversation(r.id);
    else if (r.url) window.open(r.url, "_blank");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      const r = results[idx];
      if (r) activate(r);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mx-4 w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 dark:border-slate-700">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search pages, conversations, KB articles…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
           aria-label="Search commands"/>
          <kbd className="shrink-0 rounded border bg-slate-50 px-1.5 py-0.5 text-xs text-muted-foreground dark:border-slate-600 dark:bg-slate-800">
            Esc
          </kbd>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">No results</div>
          ) : (
            results.map((r, i) => {
              const active = i === idx;
              const key = r.kind + (r as any).id + i;
              const run = () => activate(r);
              return (
                <button
                  key={key}
                  onMouseEnter={() => setIdx(i)}
                  onClick={run}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                    active ? "bg-blue-50 dark:bg-blue-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800",
                  ].join(" ")}
                >
                  {r.kind === "page" ? (
                    <span className="shrink-0 text-blue-600 dark:text-blue-400">{r.icon}</span>
                  ) : r.kind === "conv" ? (
                    <MessageSquare className="size-4 shrink-0 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <BookOpen className="size-4 shrink-0 text-teal-600 dark:text-teal-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.label}</span>
                  <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                    {r.kind === "page" ? "Page" : r.kind === "conv" ? "Conversation" : "KB"}
                    {r.kind === "conv" && r.when ? ` · ${String(r.when).slice(0, 10)}` : ""}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

