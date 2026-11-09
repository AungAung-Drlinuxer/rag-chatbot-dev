/** Hash-router — the single owner of nav state (refresh keeps the page, v0.18.2). */
import { useEffect, useState } from "react";

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

export function useHashNav(): [NavId, (n: string) => void] {
  const [nav, setNavState] = useState<NavId>(hashToNav);

  const setNav = (n: string) => {
    setNavState(hashToNav(pathForNav(n)));
    window.history.replaceState(null, "", pathForNav(n));
  };

  // back/forward + manual hash edits keep the shell in sync
  useEffect(() => {
    const onHash = () => setNavState(hashToNav());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return [nav, setNav];
}
