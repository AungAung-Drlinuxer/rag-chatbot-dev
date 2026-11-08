/** Hash-router — the single owner of nav state (refresh keeps the page, v0.18.2). */
import { useEffect, useState } from "react";

export const NAV_IDS = [
  "chat", "dashboard", "articles", "tickets", "domains", "users", "history", "audits", "settings",
] as const;
export type NavId = (typeof NAV_IDS)[number];

function hashToNav(): NavId {
  const h = window.location.hash.replace(/^#\/?/, "");
  return (NAV_IDS as readonly string[]).includes(h) ? (h as NavId) : "chat";
}

export function useHashNav(): [NavId, (n: string) => void] {
  const [nav, setNavState] = useState<NavId>(hashToNav);

  const setNav = (n: string) => {
    const v: NavId = (NAV_IDS as readonly string[]).includes(n) ? (n as NavId) : "chat";
    setNavState(v);
    window.history.replaceState(null, "", v === "chat" ? "#/" : `#/${v}`);
  };

  // back/forward + manual hash edits keep the shell in sync
  useEffect(() => {
    const onHash = () => setNavState(hashToNav());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return [nav, setNav];
}
