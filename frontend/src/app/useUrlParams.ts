/**
 * Page state that belongs in the address bar.
 *
 * A filtered list is a thing people send to each other ("the failed sign-ins from Tuesday"),
 * and a refresh is a thing people do. If the filters live only in React state, both break:
 * the link opens an unfiltered page and the refresh throws the work away.
 *
 * This keeps the selected keys in the hash query (`#/audits?q=vpn&page=2`), leaves every other
 * parameter alone, and uses `replaceState` so filtering does not fill the back button.
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
  const read = useCallback(() => {
    const all = readHashParams();
    const picked = {} as Record<K, string>;
    for (const key of keys) picked[key] = all[key] ?? "";
    return picked;
  }, [keys]);

  const [values, setValues] = useState<Record<K, string>>(read);

  useEffect(() => {
    const onHash = () => setValues(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [read]);

  const set = useCallback((patch: Partial<Record<K, string | null>>) => {
    writeHashParams(patch as Record<string, string | null>);
    setValues(read());
  }, [read]);

  return [values, set];
}
