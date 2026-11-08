import { useEffect, useState } from "react";
import { apiFetch, BASE } from "@/shared/api/client";

export type Branding = { logo: string | null; appName: string | null };

let cache: Branding | null = null;
const listeners = new Set<(b: Branding) => void>();

export function refreshBrandingCache(b: Branding) {
  cache = b;
  listeners.forEach((l) => l(b));
}

/** Global branding (logo + app name). Public endpoint; cached per session. */
export function useBranding(): Branding {
  const [b, setB] = useState<Branding>(cache ?? { logo: null, appName: null });
  useEffect(() => {
    const l = (v: Branding) => setB(v);
    listeners.add(l);
    if (!cache) {
      apiFetch(`${BASE}/api/branding`)
        .then((r) => (r.ok ? r.json() : { logo: null, appName: null }))
        .then((v) => { cache = v; setB(v); listeners.forEach((x) => x(v)); })
        .catch(() => {});
    }
    return () => { listeners.delete(l); };
  }, []);
  return b;
}
