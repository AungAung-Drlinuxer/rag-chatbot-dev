/** Hash-router — the single owner of nav state (refresh keeps the page, v0.18.2). */
import { useEffect, useRef, useState } from "react";

export const NAV_IDS = [
  "chat", "dashboard", "articles", "tickets", "domains", "users", "history", "audits", "settings",
] as const;
export type NavId = (typeof NAV_IDS)[number];

export function hashToNav(hash: string = window.location.hash): NavId {
  const h = hash.replace(/^#\/?/, "").split("?")[0];
  return (NAV_IDS as readonly string[]).includes(h) ? (h as NavId) : "chat";
}

/** The hash a nav id owns. `chat` is the app root, so it is plain `#/`. */
export function pathForNav(n: string): string {
  const v: NavId = (NAV_IDS as readonly string[]).includes(n) ? (n as NavId) : "chat";
  return v === "chat" ? "#/" : `#/${v}`;
}

/** The conversation the chat page is showing, from `#/?c=<session id>`.
 *
 *  The open conversation used to live only in React state, so a refresh — or opening the
 *  URL again — minted a fresh session id and dropped the reader into a new chat. */
export function conversationFromHash(hash: string = window.location.hash): string | null {
  // Only the chat page owns `c`: a stale parameter on another page must not reopen a chat.
  if (hashToNav(hash) !== "chat") return null;
  const q = hash.split("?")[1] ?? "";
  const id = new URLSearchParams(q).get("c");
  return id ? id : null;
}

/** Point the URL at a conversation (or at an empty chat). Replace, not push: opening ten
    conversations should not take ten "back" presses to leave the chat page. */
export function setConversationHash(id: string | null): void {
  const target = id ? `#/?c=${encodeURIComponent(id)}` : "#/";
  if (window.location.hash === target) return;
  window.history.replaceState(null, "", target);
}

/**
 * A page may need to stop a navigation: Settings has edits that are not saved yet, and
 * leaving silently throws them away. The guard lives here (not in the page) because this is
 * the only place every navigation goes through — the rail, the sidebar, the palette and the
 * keyboard all end up in `setNav`.
 */
let navGuard: (() => Promise<boolean>) | null = null;

export function registerNavGuard(guard: (() => Promise<boolean>) | null): void {
  navGuard = guard;
}

export function useHashNav(): [NavId, (n: string) => void] {
  const [nav, setNavState] = useState<NavId>(hashToNav);
  /* The hash to restore when a guard refuses a navigation: by the time the browser has told
     us about a manual hash edit, `location.hash` is already the new one. */
  const lastHash = useRef(window.location.hash);

  const setNav = (n: string) => {
    if (navGuard) {
      const guard = navGuard;
      void guard().then((leave) => { if (leave) setNavNow(n); });
      return;
    }
    setNavNow(n);
  };

  const setNavNow = (n: string) => {
    const next = hashToNav(pathForNav(n));
    setNavState(next);
    /* Going to the chat page keeps the conversation already in the URL: clicking "Chat" in
       the rail should return you to the chat you were reading, and only "New conversation"
       (which clears the parameter itself) starts a fresh one. */
    const target = next === "chat" && conversationFromHash() ? window.location.hash : pathForNav(n);
    window.history.replaceState(null, "", target);
    lastHash.current = target;
  };

  // back/forward + manual hash edits keep the shell in sync
  useEffect(() => {
    const onHash = () => {
      const next = hashToNav();
      if (navGuard) {
        const guard = navGuard;
        void guard().then((leave) => {
          if (leave) {
            setNavState(next);
            lastHash.current = window.location.hash;
          } else {
            window.history.replaceState(null, "", lastHash.current);
          }
        });
        return;
      }
      setNavState(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return [nav, setNav];
}
