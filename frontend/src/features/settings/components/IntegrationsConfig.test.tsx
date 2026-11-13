/**
 * Settings → Integrations, as the operator asked for it.
 *
 * The screen is a fixed set of four connections (Confluence, Jira, LDAP, Keycloak SSO). Two
 * controls were removed because they contradicted that: "Add integration" opened a catalogue
 * of providers this deployment cannot configure, and "Turn all off" was a single click that
 * disabled the connection the workspace depends on. This test pins their absence so a
 * well-meaning refactor does not quietly bring them back, and pins that all four providers
 * still render normally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/settings/api", () => ({
  getMySettings: vi.fn(),
  updateMySettings: vi.fn(),
  getIntegrationSettings: vi.fn(),
  putIntegrationSettings: vi.fn(),
  deleteIntegrationSettings: vi.fn(),
  testIntegration: vi.fn(),
}));

import * as settingsApi from "@/features/settings/api";
import { IntegrationsConfig } from "@/features/settings/components/IntegrationsConfig";

const m = settingsApi as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function allOn() {
  m.getMySettings.mockResolvedValue({
    settings: { integration_toggles: { confluence: true, jira: true, ldap: true, keycloak: true } },
  });
  m.getIntegrationSettings.mockResolvedValue({ fields_set: ["url"] });
  m.updateMySettings.mockResolvedValue({ ok: true });
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<IntegrationsConfig variant="admin" />); });
  await settle();
  await settle();
  return container;
}

beforeEach(() => { vi.clearAllMocks(); allOn(); });

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("Settings → Integrations", () => {
  it("no longer offers a way to turn every integration off at once", async () => {
    const text = (await mount()).textContent!;
    expect(text).not.toContain("Turn all off");
  });

  it("no longer offers an add-integration catalogue", async () => {
    const text = (await mount()).textContent!;
    expect(text).not.toContain("Add integration");
  });

  it("keeps the catalogue on screen — there is no browse mode to close", async () => {
    const el = await mount();
    expect(el.textContent).not.toContain("Close catalogue");
    expect(el.textContent).not.toContain("Browse integrations");
    // Every provider card is still there, so the list is the page. An admin gets no
    // switches: credentials are the switch.
    expect(el.querySelectorAll("[data-integration]").length).toBe(4);
    expect(el.querySelectorAll("[data-integration] button[role=\"switch\"]").length).toBe(0);
  });

  it("shows the configuration panel under the list instead of replacing it", async () => {
    const el = await mount();
    // All four are on in this fixture, so the first enabled provider's panel is open...
    expect(el.querySelector("#integration-panel")).toBeTruthy();
    // ...and the four cards are still rendered behind it.
    expect(el.querySelectorAll("[data-integration]").length).toBe(4);
  });

  it("still renders the four supported integrations with their panels", async () => {
    const text = (await mount()).textContent!;
    expect(text).toContain("Confluence");
    expect(text).toContain("Jira");
    expect(text).toContain("LDAP / Active Directory");
    expect(text).toContain("Keycloak SSO");
    // The count strip ("0 of 4 integrations enabled / 3 configured · 0 in use") is gone:
    // it contradicted the cards, which already say Configured or Not set up.
    expect(text).not.toContain("integrations enabled");
    expect(text).not.toContain("configured · ");
  });
});
