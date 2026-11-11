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
import { hashToNav, useHashNav } from "@/app/router";
import { useDisplayFit } from "@/app/useDisplayFit";
import { denied } from "@/app/acl";
import AccessRestricted from "@/components/AccessRestricted";
import { useSidebarCollapsed } from "@/app/useSidebar";
import { applyStoredTheme, applyUserPrefs } from "@/app/theme";
import { usernameFromToken } from "@/app/session";
import {
  setAuthToken, setRefreshToken, loadTokens, saveTokens, clearTokens, BASE,
  loadTokensSync,
  loadMeSync,
  saveMeCache,
} from "@/shared/api/client";
import { login, getMe, exchangeSsoCode, getSsoEnabled, type SsoInfo } from "@/features/auth/api";
import { getMySettings } from "@/features/settings/api";

import LoginPage from "@/features/auth/pages/LoginPage";
import ChatPage from "@/features/chat/pages/ChatPage";
import { Suspense, lazy } from "react";
import { PageFallback } from "@/components/PageFallback";
import { displayAppName, useBranding } from "@/app/useBranding";

/**
 * Route-level code splitting.
 *
 * Before this, every page shipped in ONE 598 kB chunk (158 kB gzip): the login screen
 * dragged in the dashboard, tickets, users and settings bundles before it could paint.
 * Login and Chat are the two routes a session starts on, so they stay eager; everything
 * else is fetched the first time its nav item is selected.
 */
const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
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
  /* The tab title is branding, not a constant: an administrator who names the workspace
     should see that name in the tab and in anything the app shares. */
  const brand = useBranding();
  useEffect(() => {
    document.title = displayAppName(brand.appName);
  }, [brand.appName]);
  const [nav, setNav] = useHashNav();
  /* The interface follows the screen it is on: px-based css, so the scale is a zoom. */
  useDisplayFit();
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

  /* Restore the in-memory token and the signed-in state from the tab's cached session
     during the first render, so a refresh paints the page the user was on — not the login
     screen for a frame, which then raced the restore and sent them to chat. */
  const initialSession = useState(() => {
    const cached = loadTokensSync();
    if (cached?.access) {
      setAuthToken(cached.access);
      setRefreshToken(cached.refresh ?? null);
    }
    return cached;
  })[0];
  const [authed, setAuthed] = useState(Boolean(initialSession?.access));
  /* False until the stored session has been read. Rendering the login screen before that
     point (and letting it rewrite the URL) is what bounced a refresh on `#/articles` to the
     chat page: for a few hundred milliseconds the app believed nobody was signed in. */
  const [booted, setBooted] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [userName, setUserName] = useState(
    initialSession?.access ? usernameFromToken(initialSession.access) : "",
  );
  /* The menu is drawn from `permissions`. Seeding them from the tab's cached identity
     means the first paint after a refresh is already the right menu — before, the state
     started empty, every entry rendered for a moment, and the restriction landed a second
     later (the "other pages flash, then disappear" report). */
  const initialMe = useState(() => loadMeSync())[0];
  const [role, setRole] = useState(initialMe?.role ?? "");
  const [perms, setPerms] = useState<Record<string, boolean>>(initialMe?.permissions ?? {});
  const [meDisplay, setMeDisplay] = useState(initialMe?.displayRole ?? "");
  const [sso, setSso] = useState<SsoInfo>({ enabled: false, provider: "", label: "", realm: "" });

  /** Apply /api/me and remember it for the next refresh's first paint. */
  function applyMe(m: { role?: string; displayRole?: string; permissions?: Record<string, boolean> }) {
    const permissions = m.permissions ?? {};
    setRole(m.role ?? "");
    setPerms(permissions);
    setMeDisplay(m.displayRole ?? "");
    saveMeCache({ role: m.role ?? "", displayRole: m.displayRole ?? "", permissions });
  }

  /** Shared by password login and the SSO callback — one place that completes a session. */
  async function applySession(data: { access_token: string; refresh_token?: string; username?: string }, fallbackUser = "") {
    setAuthToken(data.access_token);
    setRefreshToken(data.refresh_token ?? null);
    await saveTokens(data.access_token, data.refresh_token ?? "");
    setUserName(data.username ?? fallbackUser);
    setAuthed(true);
    setNav("chat");
    getMe().then(applyMe).catch(() => {});
    getMySettings().then(applyUserPrefs).catch(() => {});
  }

  /** Identity provider is only offered when a realm is actually configured. */
  useEffect(() => { getSsoEnabled().then(setSso).catch(() => setSso({ enabled: false, provider: "", label: "", realm: "" })); }, []);

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

  // Restore session on mount. The browser copy is read synchronously first, so an
  // already signed-in tab never paints the login screen (or rewrites the URL) on refresh.
  useEffect(() => {
    loadTokens().then((t) => {
      if (t?.access) {
        setAuthToken(t.access);
        setRefreshToken(t.refresh ?? null);
        setUserName(usernameFromToken(t.access));
        setAuthed(true);
        getMe().then(applyMe).catch(() => {});
        getMySettings().then(applyUserPrefs).catch(() => {}); // theme engine on restore
      }
    }).catch(() => {}).finally(() => setBooted(true));
  }, []);

  /* A genuinely signed-out visitor on a deep link is moved to the root once — but only
     after the session restore has finished, and never for the SSO callback. */
  useEffect(() => {
    if (!booted || authed) return;
    const hash = window.location.hash;
    if (hash.startsWith("#/sso")) return;
    if (hash && hash !== "#/" && hashToNav(hash) !== "chat") window.history.replaceState(null, "", "/");
  }, [booted, authed]);

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
    /* Leaving `#/settings` (or any other page) in the address bar meant the sign-in screen
       lived at /#/settings — reloading it, or sending that link to a colleague, landed on
       a protected page. Logging out returns to the app root. */
    setNav("chat");
    window.history.replaceState(null, "", "/");
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
    // onLogout is stable in behaviour (clears tokens + state); re-binding on each render
    // would drop an expiry event that arrives during the swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shell = (active: string, children: React.ReactNode) => (
    <>
      <div className="flex h-[100dvh] overflow-hidden">
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
        sso={sso}
        onSso={() => { window.location.href = `${BASE}/api/auth/sso/login`; }}
      />
    );
  }

  const block = denied(nav, perms);
  const roleLabel = meDisplay || ({ admin: "Administrator",
    knowledge: "Knowledge Manager", domain_manager: "Knowledge Manager" } as Record<string, string>)[role || "user"];

  if (block) {
    return shell(nav, <AccessRestricted capability={block.label} roleLabel={roleLabel} />);
  }

  return (
    <FloatingChatProvider>
      {(() => { switch (nav) {
    case "chat":
      return shell("chat", <ChatPage userName={userName} role={role} displayRole={meDisplay} perms={perms} onNavigate={setNav} onLogout={onLogout} />);
    case "dashboard":
      return shell("dashboard", <DashboardPage userName={userName} role={role} perms={perms} />);
    case "articles":
      return shell("articles", <KnowledgePage role={role} userName={userName} perms={perms} onToast={toast.push} />);
    case "tickets":
      return shell("tickets", <TicketsPage role={role} userName={userName} onToast={toast.push} />);
    case "domains":
      // Its own page again: routing configuration and article reading are different jobs.
      return shell("domains", <DomainsPage role={role} perms={perms} />);
    case "users":
      return shell("users", <UsersPage />);
    case "history":
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
