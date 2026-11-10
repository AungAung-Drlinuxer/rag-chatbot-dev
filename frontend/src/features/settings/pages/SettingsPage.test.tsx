/**
 * SettingsPage — preferences, the grouped nav and the admin-only panels.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component. Its
 * load-bearing behaviour is (a) which panels a role may SEE, (b) which controls appear on
 * the active panel, and (c) the instant theme side-effects `applyThemeNow` writes onto
 * <html>. None of that is reachable without rendering.
 *
 * The failure this guards: the theme/density/font controls apply immediately AND are saved;
 * if the immediate side-effect stops firing, the preview silently diverges from the saved
 * value. The role gate is the other one — a non-admin must never see the Integrations or
 * Mail panels.
 *
 * The three heavy child panels (IntegrationsConfig, BrandingSettings, AiServiceSettings)
 * are stubbed: they own their own network state and are not this page's
 * subject. Everything the page itself does is exercised for real.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act() + direct DOM
 * queries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/settings/api", () => ({
  getMySettings: vi.fn(),
  updateMySettings: vi.fn(),
  getIntegrationSettings: vi.fn(),
  getSetupReadiness: vi.fn(async () => ({
    ready: true, steps: [],
    database: { tables: 29, vector_version: "0.8.0", checkpoints: true, ok: true },
    knowledge: { confluence_configured: false, spaces: [], articles: 0, domains: 0, last_sync: null },
  })),
  getSmtpSettings: vi.fn(),
  putSmtpSettings: vi.fn(),
  sendTestEmail: vi.fn(),
}));

vi.mock("@/features/dashboard/api", () => ({
  dashHealth: vi.fn(),
  dashStats: vi.fn(),
  dashConversations: vi.fn(),
  dashDomains: vi.fn(),
  dashRecentConversations: vi.fn(),
  dashRecentTickets: vi.fn(),
  dashGateTrend: vi.fn(),
}));

vi.mock("../components/IntegrationsConfig", () => ({
  IntegrationsConfig: () => <div data-stub="integrations">IntegrationsConfig panel</div>,
}));
vi.mock("../components/BrandingSettings", () => ({
  BrandingSettings: () => <div data-stub="branding">BrandingSettings panel</div>,
  // the page now loads the brand name itself, so it needs this too
  fetchBranding: () => Promise.resolve({ logo: null, appName: null }),
}));
vi.mock("../components/AiServiceSettings", () => ({
  AiServiceSettings: () => <div data-stub="ai">AiServiceSettings panel</div>,
}));

import * as settingsApi from "@/features/settings/api";
import * as dashApi from "@/features/dashboard/api";
import Settings from "./SettingsPage";

const m = settingsApi as unknown as Record<string, any>;
const dash = dashApi as unknown as Record<string, any>;

const PREF = {
  theme: "light", density: "comfortable", compact: false, animations: true,
  chat_font_size: 14, show_rag_sources: true, show_token_usage: true, markdown_rendering: true,
};

function happyPath() {
  m.getMySettings.mockResolvedValue({ ...PREF });
  m.updateMySettings.mockResolvedValue({ ...PREF });
  m.getSmtpSettings.mockResolvedValue({ smtp: { port: 587, use_tls: true, enabled: true, password_set: true, alerts: {} }, fields_set: ["host", "from_address"] });
  m.putSmtpSettings.mockResolvedValue({ ok: true });
  m.sendTestEmail.mockResolvedValue({ ok: true, to: "a@b.com" });
  m.getIntegrationSettings.mockResolvedValue({ settings: {} });
  dash.dashHealth.mockResolvedValue({ services: [] });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function mount(role?: string) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Settings role={role} />); });
  await settle();
  return container;
}

const navBtn = (el: ParentNode, label: string) =>
  [...el.querySelectorAll('nav[aria-label="Settings sections"] button')].find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;

const button = (el: ParentNode, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

async function click(el: Element | undefined | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-compact");
  document.documentElement.classList.remove("animations-off");
  document.documentElement.style.removeProperty("--chat-font-size");
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("SettingsPage — role gating and the grouped nav", () => {
  it("shows an admin all five nav entries and the Administrator badge", async () => {
    const el = await mount("admin");
    const nav = el.querySelector('nav[aria-label="Settings sections"]')!;
    expect(nav.querySelectorAll("button")).toHaveLength(4);
    expect(nav.textContent).toContain("Preferences");
    expect(nav.textContent).toContain("Integrations");
    expect(nav.textContent).toContain("AI service");
    expect(nav.textContent).toContain("Email server");
    expect(el.textContent).toContain("Administrator");
  });

  it("shows a non-admin ONLY Preferences, and hides the admin-only panels", async () => {
    const el = await mount("user");
    const nav = el.querySelector('nav[aria-label="Settings sections"]')!;
    expect(nav.querySelectorAll("button")).toHaveLength(1);
    expect(nav.textContent).toContain("Preferences");
    expect(nav.textContent).not.toContain("Integrations");
    // Branding lives inside the general panel but is admin-gated.
    expect(el.querySelector('[data-stub="branding"]')).toBeNull();
    // Integrations are fully administrator-only: no panel, and no "My integrations"
    // catalogue either — it probed every provider's configuration on mount.
    expect(el.querySelector('[data-stub="integrations"]')).toBeNull();
    expect(el.textContent).not.toContain("My integrations");
  });

  it("opens the Integrations panel (with service status) from the nav", async () => {
    const el = await mount("admin");
    await click(navBtn(el, "Integrations"));
    expect(el.querySelector('[data-stub="integrations"]')).toBeTruthy();
    expect(el.textContent).toContain("Service status");
    expect(m.getIntegrationSettings).toHaveBeenCalled();
  });

  it("opens the AI service panel from the nav", async () => {
    const el = await mount("admin");
    await click(navBtn(el, "AI service"));
    expect(el.querySelector('[data-stub="ai"]')).toBeTruthy();
  });

  it("shows the Branding panel to an admin on the general panel", async () => {
    const el = await mount("admin");
    expect(el.querySelector('[data-stub="branding"]')).toBeTruthy();
  });
});

describe("SettingsPage — preferences panel and instant side-effects", () => {
  it("renders the Chat and Appearance sections with their controls", async () => {
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("Settings");
    expect(text).toContain("Chat");
    expect(text).toContain("Show source citations");
    expect(text).toContain("Show token usage");
    expect(text).toContain("Format Markdown");
    expect(text).toContain("Appearance");
    expect(text).toContain("Theme mode");
    expect(text).toContain("Compact mode");
  });

  it("applies the saved theme on load", async () => {
    m.getMySettings.mockResolvedValue({ ...PREF, theme: "dark" });
    await mount("admin");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("switches the theme immediately when 'dark' is clicked", async () => {
    const el = await mount("admin");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    const darkBtn = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "dark")!;
    await click(darkBtn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("toggles a preference row and saves the whole payload", async () => {
    const el = await mount("admin");
    const citations = [...el.querySelectorAll('button[aria-pressed]')].find((b) =>
      b.parentElement?.parentElement?.textContent?.includes("Show source citations"),
    ) as HTMLButtonElement;
    expect(citations.getAttribute("aria-pressed")).toBe("true");
    await click(citations);
    expect(citations.getAttribute("aria-pressed")).toBe("false");

    await click(button(el, "Save changes"));
    expect(m.updateMySettings).toHaveBeenCalledWith(
      expect.objectContaining({ show_rag_sources: false, theme: "light", chat_font_size: 14 }),
    );
    expect(el.textContent).toContain("Saved");
  });

  it("surfaces a settings-load failure in the header", async () => {
    m.getMySettings.mockRejectedValue(new Error("settings 500"));
    const el = await mount("admin");
    expect(el.textContent).toContain("settings 500");
  });
});

describe("SettingsPage — admin Mail (SMTP) panel", () => {
  it("loads the SMTP panel and shows stored fields as write-only", async () => {
    const el = await mount("admin");
    await click(navBtn(el, "Email server"));
    const text = el.textContent!;
    expect(text).toContain("Mail (SMTP)");
    expect(text).toContain("saved — not retrievable");
    expect(text).toContain("write-only");
    expect(m.getSmtpSettings).toHaveBeenCalled();
  });

  it("reports a failed SMTP load instead of an empty form", async () => {
    m.getSmtpSettings.mockRejectedValue(new Error("smtp down"));
    const el = await mount("admin");
    await click(navBtn(el, "Email server"));
    expect(el.textContent).toContain("Failed to load mail settings");
  });

  it("never mounts the Mail panel for a non-admin", async () => {
    const el = await mount("user");
    expect(el.textContent).not.toContain("Mail (SMTP)");
    expect(m.getSmtpSettings).not.toHaveBeenCalled();
  });
});
