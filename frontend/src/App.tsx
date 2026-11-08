/** App shell — session bootstrap + hash-routed page switch.
 *
 * Governance (see frontend/README.md): this file owns NO endpoint logic and NO
 * feature UI. Feature pages live in src/features/<domain>/pages, shared nav in
 * components/PageSidebar.tsx, theme/router/session in src/app/.
 * B-3: collapsible sidebar (Cmd/Ctrl+B, persisted). B-4: global Cmd+K palette.
 */
import { useEffect, useState } from "react";
import { useToast, ToastHost } from "@/shared/useToast";
import PageSidebar from "@/components/PageSidebar";
import CommandPalette from "@/components/CommandPalette";
import { NeedHelpCard } from "@/components/NeedHelpCard";
import { FloatingChatProvider, FloatingChatPopup } from "@/components/FloatingChat";
import { useHashNav } from "@/app/router";
import { useSidebarCollapsed } from "@/app/useSidebar";
import { applyStoredTheme, applyUserPrefs } from "@/app/theme";
import { usernameFromToken } from "@/app/session";
import {
  setAuthToken, setRefreshToken, loadTokens, saveTokens, clearTokens, BASE,
} from "@/shared/api/client";
import { login, getMe, exchangeSsoCode, getSsoEnabled } from "@/features/auth/api";
import { getMySettings } from "@/features/settings/api";

import LoginPage from "@/features/auth/pages/LoginPage";
import ChatPage from "@/features/chat/pages/ChatPage";
import { Suspense, lazy } from "react";
import { PageFallback } from "@/components/PageFallback";

/**
 * Route-level code splitting.
 *
 * Before this, every page shipped in ONE 598 kB chunk (158 kB gzip): the login screen
 * dragged in the dashboard, tickets, users and settings bundles before it could paint.
 * Login and Chat are the two routes a session starts on, so they stay eager; everything
 * else is fetched the first time its nav item is selected.
 */
const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const ObservabilityPage = lazy(() => import("@/features/observability/pages/ObservabilityPage"));
const KnowledgePage = lazy(() => import("@/features/knowledge/pages/KnowledgePage"));
const TicketsPage = lazy(() => import("@/features/tickets/pages/TicketsPage"));
const DomainsPage = lazy(() => import("@/features/domains/pages/DomainsPage"));
const UsersPage = lazy(() => import("@/features/users/pages/UsersPage"));
const ConversationHistoryPage = lazy(() => import("@/features/conversations/pages/ConversationHistoryPage"));
const AuditsPage = lazy(() => import("@/features/audits/pages/AuditsPage"));
const SettingsPage = lazy(() => import("@/features/settings/pages/SettingsPage"));

export default function App() {
  // v0.21.44 — apply persisted theme on every page load (previously only Settings
  // did, so refreshing on other pages reset the theme).
  useEffect(() => { applyStoredTheme(); }, []);
  const [nav, setNav] = useHashNav();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const toast = useToast();

  // B-4 — global Cmd/Ctrl+K opens the shell-level palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const [authed, setAuthed] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("");
  const [perms, setPerms] = useState<Record<string, boolean>>({});
  const [meDisplay, setMeDisplay] = useState("");
  const [ssoEnabled, setSsoEnabled] = useState(false);

  /** Shared by password login and the SSO callback — one place that completes a session. */
  async function applySession(data: { access_token: string; refresh_token?: string; username?: string }, fallbackUser = "") {
    setAuthToken(data.access_token);
    setRefreshToken(data.refresh_token ?? null);
    await saveTokens(data.access_token, data.refresh_token ?? "");
    setUserName(data.username ?? fallbackUser);
    setAuthed(true);
    setNav("chat");
    getMe().then((m) => { setRole(m.role); setPerms(m.permissions ?? {}); setMeDisplay(m.displayRole ?? ""); }).catch(() => {});
    getMySettings().then(applyUserPrefs).catch(() => {});
  }

  /** Identity provider is only offered when a realm is actually configured. */
  useEffect(() => { getSsoEnabled().then(setSsoEnabled).catch(() => setSsoEnabled(false)); }, []);

  // SSO returns to `#/sso?code=…` (success) or `#/login?sso_error=…` (everything else).
  // The reason travels as a short code, never as provider text, so nothing from the
  // token endpoint can end up rendered on the login page.
  useEffect(() => {
    const hash = window.location.hash;
    const ok = hash.match(/^#\/sso\?code=([^&]+)/);
    const bad = hash.match(/^#\/login\?sso_error=([a-z]+)/);
    const clean = () => window.history.replaceState(null, "", window.location.pathname + "#/login");
    if (bad) {
      const reasons: Record<string, string> = {
        pending: "Registration pending — single sign-on verified your account, but an administrator must approve it on the Users page before you can sign in.",
        disabled: "Your account has been disabled by an administrator. Please contact IT.",
        denied: "Single sign-on was cancelled before it finished.",
        unavailable: "Single sign-on is not configured for this workspace — sign in with your password.",
        failed: "Single sign-on could not be completed. Please try again, or use your password.",
        invalid: "That sign-in link is no longer valid. Please start again.",
      };
      setLoginErr(reasons[bad[1]] ?? reasons.failed);
      clean();
      return;
    }
    if (ok) {
      exchangeSsoCode(decodeURIComponent(ok[1]))
        .then((data) => applySession(data))
        .catch((err) => setLoginErr(String(err?.message ?? err).replace(/^Error:\s*/, "")))
        .finally(clean);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore session from OS keyring on mount (Phase 5).
  useEffect(() => {
    loadTokens().then((t) => {
      if (t?.access) {
        setAuthToken(t.access);
        setRefreshToken(t.refresh ?? null);
        setUserName(usernameFromToken(t.access));
        setAuthed(true);
        getMe().then((m) => { setRole(m.role); setPerms(m.permissions ?? {}); setMeDisplay(m.displayRole ?? ""); }).catch(() => {});
        getMySettings().then(applyUserPrefs).catch(() => {}); // theme engine on restore
      }
    }).catch(() => {});
  }, []);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr("");
    try {
      const data = await login(loginUser, loginPass);
      await applySession(data, loginUser);
    } catch (err: any) {
      // v0.21.57 — show the backend's reason verbatim (e.g. the account-disabled
      // message) instead of "Error: Login failed (HTTP 403)".
      setLoginErr(err?.message ? String(err.message).replace(/^Error:\s*/, "") : String(err));
    }
  }

  async function onLogout() {
    await clearTokens();
    setAuthToken(null);
    setRefreshToken(null);
    setUserName("");
    setLoginUser("");
    setLoginPass("");
    setLoginErr("");
    setAuthed(false);
    // Note: Do NOT reset data-theme to light on logout so the user's preferred theme persists seamlessly
  }

  // v1.1.9 — JWT rotated server-side (secret rotation) → stale sessions can't recover.
  // Any page that gets a 401 after a failed refresh dispatches this; force logout → login page.
  useEffect(() => {
    const onExpired = () => {
      void onLogout();
      setLoginErr("Your session has expired — please sign in again.");
    };
    window.addEventListener("ith:session-expired", onExpired);
    return () => window.removeEventListener("ith:session-expired", onExpired);
  }, []);

  const shell = (active: string, children: React.ReactNode) => (
    <>
      <div className="flex h-screen overflow-hidden">
        <PageSidebar active={active} onNavigate={setNav} userName={userName} role={role}
          displayRole={meDisplay} perms={perms} onLogout={onLogout}
          collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        {/* The content column is a flex stack: the page scroll area fills it, so a page
            that fills the height (e.g. the dashboard) gets the remaining space, not the
            full viewport. There is no shell-level top bar any more — every page leads with
            its own header block, exactly like the chat column. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* No shell-level top bar (v1.3.0): every workspace page now leads with its own
              in-page header, the same shape the chat column uses — breadcrumb, title,
              description and actions in one block that scrolls with the content. */}
          <div data-slot="page-scroll" className={active === "chat" ? "min-w-0 flex-1 overflow-hidden" : "min-w-0 flex-1 overflow-y-auto"}>
            <Suspense fallback={<PageFallback />}>{children}</Suspense>
          </div>
        </div>
      </div>
      {active !== "chat" && <NeedHelpCard />}
      <FloatingChatPopup />
      {authed && (
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onNavigate={setNav}
          onOpenConversation={(id) => { setNav("chat"); window.dispatchEvent(new CustomEvent("ith:open-conversation", { detail: id })); }}
          enabled={perms}
        />
      )}
      <ToastHost toast={toast.toast} />
    </>
  );

  if (!authed) {
    return (
      <LoginPage
        loginUser={loginUser} setLoginUser={setLoginUser}
        loginPass={loginPass} setLoginPass={setLoginPass}
        loginErr={loginErr} onSubmit={onLogin}
        ssoEnabled={ssoEnabled}
        onSso={() => { window.location.href = `${BASE}/api/auth/sso/login`; }}
      />
    );
  }

  return (
    <FloatingChatProvider>
      {(() => { switch (nav) {
    case "chat":
      return shell("chat", <ChatPage userName={userName} role={role} displayRole={meDisplay} perms={perms} onNavigate={setNav} onLogout={onLogout} />);
    case "dashboard":
      return shell("dashboard", <DashboardPage userName={userName} role={role} />);
    case "observability":
      return shell("observability", <ObservabilityPage role={role} />);
    case "articles":
      return shell("articles", <KnowledgePage role={role} userName={userName} perms={perms} onToast={toast.push} />);
    case "tickets":
      return shell("tickets", <TicketsPage role={role} userName={userName} onToast={toast.push} />);
    case "domains":
      // Its own page again: routing configuration and article reading are different jobs.
      return shell("domains", <DomainsPage role={role} perms={perms} />);
    case "users":
      return shell("users", <UsersPage />);    case "history":
      return shell("history", <ConversationHistoryPage />);
    case "audits":
      return shell("audits", <AuditsPage />);
    case "settings":
      return shell("settings", <SettingsPage role={role} />);
    default:
      return shell("chat", <ChatPage userName={userName} role={role} displayRole={meDisplay} perms={perms} onNavigate={setNav} onLogout={onLogout} />);
      } })()}
    </FloatingChatProvider>
  );
}
