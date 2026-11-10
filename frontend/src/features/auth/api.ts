/** Auth feature API — login + identity (mirrors backend /api/auth/*). */
import { BASE, apiFetch, authHeaders } from "@/shared/api/client";

export async function login(username: string, password: string) {
  const r = await apiFetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) {
    // v0.21.57 — surface the server's reason (e.g. "Your account has been
    // disabled by an administrator") instead of a bare HTTP code.
    let msg = `Login failed (HTTP ${r.status})`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch { /* non-JSON error body */ }
    throw new Error(msg);
  }
  const data = await r.json();
  return data; // { access_token, refresh_token, username }
}

export async function getMe() {
  const r = await apiFetch(`${BASE}/api/auth/me`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json(); // { username, role, displayRole, permissions }
}

/** Login-page backend reachability probe (no auth). */
export async function healthPing(): Promise<boolean> {
  try {
    const r = await apiFetch(`${BASE}/health`);
    return r.ok;
  } catch {
    return false;
  }
}

export type SsoInfo = {
  enabled: boolean;
  /** "keycloak" today; the page labels the button from this, never from a guess. */
  provider: string;
  label: string;
  realm: string;
};

const NO_SSO: SsoInfo = { enabled: false, provider: "", label: "", realm: "" };

/** Is an OIDC realm configured, and which one? The login page offers the button only
 *  when it is, and names the provider instead of saying a generic "SSO". */
export async function getSsoEnabled(): Promise<SsoInfo> {
  try {
    const r = await apiFetch(`${BASE}/api/auth/sso/enabled`);
    if (!r.ok) return NO_SSO;
    const j = await r.json();
    return {
      enabled: !!j?.enabled,
      provider: String(j?.provider ?? ""),
      label: String(j?.label ?? ""),
      realm: String(j?.realm ?? ""),
    };
  } catch {
    return NO_SSO;
  }
}

/** Trade the one-time code from the SSO callback for the app's own tokens. */
export async function exchangeSsoCode(code: string) {
  const r = await apiFetch(`${BASE}/api/auth/sso/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!r.ok) {
    let msg = `Sign-in failed (HTTP ${r.status})`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch { /* non-JSON body */ }
    throw new Error(msg);
  }
  return r.json(); // { access_token, refresh_token, username }
}
