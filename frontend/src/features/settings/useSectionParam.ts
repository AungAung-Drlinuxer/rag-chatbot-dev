/**
 * Which Settings section is open, kept in the URL as `#/settings?tab=<id>`.
 *
 * The section used to be React state only, so refreshing a page you had just navigated to put
 * you back on Preferences, and "look at Data retention" could not be sent as a link. The hash
 * router already carries the page (`#/settings`); carrying the tab alongside it costs nothing
 * and makes the page shareable and refresh-safe.
 *
 * `replaceState`, not a push: switching tabs should not fill the back button with tab history.
 */
import { useCallback, useEffect, useState } from "react";

export function sectionFromHash(valid: readonly string[], fallback: string): string {
  const query = window.location.hash.split("?")[1] ?? "";
  const tab = new URLSearchParams(query).get("tab");
  return tab && valid.includes(tab) ? tab : fallback;
}

export function useSectionParam(
  valid: readonly string[],
  fallback: string,
  page: string,
): [string, (id: string) => void] {
  const [section, setSection] = useState(() => sectionFromHash(valid, fallback));

  /* Back/forward and hand-edited URLs: the router rewrites the hash for page nav, and a link
     carrying `?tab=` must land on that tab even though the component is already mounted. */
  useEffect(() => {
    const onHash = () => setSection(sectionFromHash(valid, fallback));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [valid, fallback]);

  const select = useCallback(
    (id: string) => {
      setSection(id);
      const target = `#/${page}?tab=${encodeURIComponent(id)}`;
      if (window.location.hash !== target) window.history.replaceState(null, "", target);
    },
    [page],
  );

  return [section, select];
}
