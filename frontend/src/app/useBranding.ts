import { useEffect, useState } from "react";
import { apiFetch, BASE } from "@/shared/api/client";

export type Branding = { logo: string | null; appName: string | null };

/* No product name is baked into the UI. Until an administrator names the workspace, the
   app calls itself something plain and the mark is the initials of that name — never a
   hard-coded "iTH". */
export const DEFAULT_APP_NAME = "IT Help";

/** Two initials from the brand name: "IT Help Chatbot" → "IH", "Zenith" → "ZE". */
export function brandInitials(appName?: string | null): string {
  const name = (appName || "").trim() || DEFAULT_APP_NAME;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** The name to print: the administrator's, or the neutral default. */
export function displayAppName(appName?: string | null): string {
  return (appName || "").trim() || DEFAULT_APP_NAME;
}

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
