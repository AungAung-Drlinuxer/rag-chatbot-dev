/** Shared HTTP client — fetch + JWT Bearer auth + transparent 401 refresh + Tauri keyring.
 *
 * Structure rule (governance): feature modules under src/features/<name>/api.ts are the
 * ONLY place endpoint calls live; components import from their feature, never raw
 * fetch. This module owns transport concerns only: base URL, tokens, refresh, authHeaders.
 */
import { invoke } from "@tauri-apps/api/core";

export const BASE = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
export const apiBase = BASE;

let authToken: string | null = null;
let refreshToken: string | null = null;
export function setAuthToken(t: string | null) {
  authToken = t;
}
export function setRefreshToken(t: string | null) {
  refreshToken = t;
}
export function getAuthToken() {
  return authToken;
}

export function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// v0.18.1 — transparent access-token refresh on 401. Concurrency-safe:
// parallel 401s await the single in-flight refresh.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const r = await apiFetch(`${BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!r.ok) return false;
        const data = await r.json();
        authToken = data.access_token;
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshInFlight = null), 0);
      }
    })();
  }
  return refreshInFlight;
}

/** fetch that auto-refreshes once on 401 then retries the original request. */
export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  /* Whether this tab was signed in when the request went out. A 401 on a request that
     never carried a token (fired while the session was still being restored) must not log
     the user out — that race is why a refresh sometimes ended on the login screen. */
  const hadSession = Boolean(authToken);
  let res = await fetch(url, init);
  if (res.status === 401) {
    if (refreshToken && (await tryRefresh())) {
      const headers = new Headers(init.headers || {});
      if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
      res = await fetch(url, { ...init, headers });
      if (res.ok && authToken) {
        // Keep the stored copy current so a reload does not fall back to an expired one.
        try {
          const stored = loadTokensSync();
          if (stored) void saveTokens(authToken, stored.refresh ?? "");
        } catch { /* storage unavailable — the in-memory token still works */ }
      }
    }
    if (res.status === 401 && hadSession && !url.includes("/api/auth/login")) {
      window.dispatchEvent(new CustomEvent("ith:session-expired"));
    }
  }
  return res;
}

// ---------- Tauri OS keyring (JWT stored securely, not localStorage) ----------
const inTauri = () => typeof window !== "undefined" && "__TAURI__" in window;

export async function saveTokens(access: string, refresh: string) {
  if (inTauri()) return invoke("save_tokens", { access, refresh });
  sessionStorage.setItem("tokens", JSON.stringify({ access, refresh }));
}
/** Synchronous read of the browser session (no keyring). Used to restore the session
 *  before the first paint in a tab, so the login screen never renders for an already
 *  signed-in user. Returns null in the desktop build, where the keyring is async. */
export function loadTokensSync(): { access: string; refresh: string } | null {
  if (inTauri()) return null;
  try {
    const v = sessionStorage.getItem("tokens");
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function loadTokens(): Promise<{ access: string; refresh: string } | null> {
  if (inTauri()) return invoke("load_tokens");
  const v = sessionStorage.getItem("tokens");
  return v ? JSON.parse(v) : null;
}
export async function clearTokens() {
  if (inTauri()) return invoke("clear_tokens");
  sessionStorage.removeItem("tokens");
}
