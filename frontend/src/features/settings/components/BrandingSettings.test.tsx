/**
 * Settings → Branding is a controlled section, not a form with its own Save.
 *
 * Three things went wrong here before and are pinned now:
 *  - the preview said "Default iTH mark in use" and drew a literal "iTH";
 *  - the name field had its own "Save name" button, so the page had two ideas of "saved";
 *  - the name placeholder was a product name.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act().
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/shared/api/client", async (orig) => {
  const real = await orig<typeof import("@/shared/api/client")>();
  return {
    ...real,
    apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ logo: null, appName: null }) } as Response)),
    authHeaders: () => ({}),
  };
});

import { BrandingSettings } from "./BrandingSettings";

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

async function mount(appName: string | null, onChange = () => {}) {
  await act(async () => {
    root.render(<BrandingSettings appName={appName} onAppNameChange={onChange} />);
  });
  await act(async () => { await Promise.resolve(); });
  return host;
}

describe("BrandingSettings", () => {
  it("does not hard-code a product mark or a product name", async () => {
    const el = await mount("");
    expect(el.textContent).not.toContain("iTH");
    expect(el.textContent).not.toMatch(/IT Help Chatbot/i);
    const input = el.querySelector<HTMLInputElement>("#brand-name");
    expect(input?.placeholder).not.toMatch(/IT Help Chatbot/i);
  });

  it("has no Save button of its own — the page owns the one Save", async () => {
    const el = await mount("Acme IT");
    const buttons = [...el.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(buttons).not.toContain("Save name");
    expect(buttons.some((t) => /^save$/i.test(t))).toBe(false);
  });

  it("draws the initials of the configured name when there is no logo", async () => {
    const el = await mount("Acme IT");
    expect(el.textContent).toContain("AI");
  });

  it("reports every keystroke to the page's form state", async () => {
    const onChange = vi.fn();
    const el = await mount("", onChange);
    const input = el.querySelector<HTMLInputElement>("#brand-name")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Global Helpdesk");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    expect(String(calls[calls.length - 1]?.[0])).toBe("Global Helpdesk");
  });
});
