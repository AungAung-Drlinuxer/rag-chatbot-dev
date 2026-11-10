/**
 * The login page offers single sign-on under its real name.
 *
 * "Sign in with SSO" told a user nothing about where they were about to be sent, and the
 * second way in is invisible to anyone who does not already know the realm exists. The
 * button is labelled from /api/auth/sso/enabled (provider + realm), so it cannot drift
 * from the installation's actual identity provider.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/useBranding", () => ({
  useBranding: () => ({ appName: "IT Help Chatbot", short: "iTH" }),
}));

// The page probes /health on mount; that is not what this suite is about.
vi.mock("@/shared/api/client", async (orig) => {
  const real = await orig<typeof import("@/shared/api/client")>();
  return { ...real, apiFetch: vi.fn(() => Promise.resolve({ ok: false } as Response)) };
});

import Login from "./LoginPage";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      <Login
        loginUser=""
        setLoginUser={() => {}}
        loginPass=""
        setLoginPass={() => {}}
        loginErr=""
        onSubmit={() => {}}
        {...props}
      />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("LoginPage — single sign-on", () => {
  it("names the provider and the realm when SSO is configured", async () => {
    const el = await mount({
      sso: { enabled: true, provider: "keycloak", label: "Keycloak", realm: "ihkp" },
      onSso: () => {},
    });
    const text = el.textContent ?? "";
    expect(text).toContain("Sign in with Keycloak");
    expect(text).toContain("via Keycloak");
    expect(text).toContain("realm ihkp");
    // The old generic label must be gone.
    expect(text).not.toContain("Sign in with SSO");
  });

  it("still says Keycloak when the realm name is not published", async () => {
    const el = await mount({
      sso: { enabled: true, provider: "keycloak", label: "Keycloak", realm: "" },
      onSso: () => {},
    });
    expect(el.textContent).toContain("Sign in with Keycloak");
    expect(el.textContent).not.toContain("realm");
  });

  it("offers no second way in when no realm is configured", async () => {
    const el = await mount();
    expect(el.textContent).not.toContain("Keycloak");
    expect(el.textContent).not.toContain("Sign in with SSO");
  });

  it("keeps working with the legacy boolean prop", async () => {
    const el = await mount({ ssoEnabled: true, onSso: () => {} });
    expect(el.textContent).toContain("Sign in with Keycloak");
  });

  it("calls onSso when the provider button is pressed", async () => {
    const onSso = vi.fn();
    const el = await mount({
      sso: { enabled: true, provider: "keycloak", label: "Keycloak", realm: "ihkp" },
      onSso,
    });
    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Keycloak"));
    expect(btn).toBeTruthy();
    await act(async () => { btn!.click(); });
    expect(onSso).toHaveBeenCalledTimes(1);
  });
});
