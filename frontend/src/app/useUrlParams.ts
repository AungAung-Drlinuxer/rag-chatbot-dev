/**
 * Page state that belongs in the address bar.
 *
 * A filtered list is a thing people send to each other ("the failed sign-ins from Tuesday"),
 * and a refresh is a thing people do. If the filters live only in React state, both break:
 * the link opens an unfiltered page and the refresh throws the work away.
 *
 * The React state is the source of truth and the hash mirrors it. Reading the hash back on
 * every set made the URL the authority, so a page rendered without a hash (a test, an embedded
 * view) silently swallowed filters. Writing is skipped when there is no hash at all.
 *
 * `replaceState`, not push: filtering should not fill the back button with every keystroke.
 */
import { useCallback, useEffect, useState } from "react";

export function readHashParams(): Record<string, string> {
  const query = window.location.hash.split("?")[1] ?? "";
  const out: Record<string, string> = {};
  new URLSearchParams(query).forEach((value, key) => { out[key] = value; });
  return out;
}

export function writeHashParams(patch: Record<string, string | null>): void {
  const [path] = window.location.hash.split("?");
  if (!path) return; // not a hash-routed page (test harness, embedded view): state stays local
  const current = readHashParams();
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") delete current[key];
    else current[key] = value;
  }
  const query = new URLSearchParams(current).toString();
  const next = query ? `${path}?${query}` : path;
  if (window.location.hash === next) return;
  window.history.replaceState(null, "", next);
}

export function useUrlParams<K extends string>(
  keys: readonly K[],
): [Record<K, string>, (patch: Partial<Record<K, string | null>>) => void] {
  const pick = useCallback((all: Record<string, string>) => {
    const picked = {} as Record<K, string>;
    for (const key of keys) picked[key] = all[key] ?? "";
    return picked;
  }, [keys]);

  const [values, setValues] = useState<Record<K, string>>(() => pick(readHashParams()));

  // Back/forward, and a pasted link while the page is already mounted.
  useEffect(() => {
    const onHash = () => setValues(pick(readHashParams()));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pick]);

  const set = useCallback((patch: Partial<Record<K, string | null>>) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(patch) as [K, string | null][]) {
        next[key] = value ?? "";
      }
      return next;
    });
    writeHashParams(patch as Record<string, string | null>);
  }, []);

  return [values, set];
}
