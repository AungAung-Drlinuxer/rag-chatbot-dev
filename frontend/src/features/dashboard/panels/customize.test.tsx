/**
 * Overview customization — the Grafana-style panel board.
 *
 * WHY A RENDER TEST: the feature is a state machine (saved layout vs draft, add/edit/remove/
 * reorder, save/reset) whose whole value is that what you see in edit mode is what gets
 * written. A unit test of the reducer would pass while the page rendered a different array.
 *
 * The failures these guard:
 *   - a saved layout that does not come back on reload (customization silently resets),
 *   - "Save layout" writing the SAVED array instead of the edited draft (edits vanish),
 *   - removing every panel leaving a blank page with no way back (Reset must be reachable),
 *   - a note panel that drops its text between the editor and the payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/dashboard/api", () => ({
  dashStats: vi.fn(),
  dashConversations: vi.fn(),
  dashDomains: vi.fn(),
  dashRecentConversations: vi.fn(),
  dashRecentTickets: vi.fn(),
  dashHealth: vi.fn(),
  dashGateTrend: vi.fn(),
}));

vi.mock("@/features/dashboard/panels/layoutApi", () => ({
  getDashboardLayout: vi.fn(),
  saveDashboardLayout: vi.fn(),
  resetDashboardLayout: vi.fn(),
}));

import * as api from "@/features/dashboard/api";
import * as layoutApi from "@/features/dashboard/panels/layoutApi";
import Dashboard from "@/features/dashboard/pages/DashboardPage";
import { DEFAULT_LAYOUT } from "@/features/dashboard/panels/types";

const m = api as unknown as Record<string, any>;
const l = layoutApi as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function happyPath() {
  m.dashStats.mockResolvedValue({
    total_conversations: 4, resolved_by_bot: 3, escalated_to_tickets: 1, active_users: 2,
    kb_pages: 9, attacks_blocked_7d: 0, deltas: {}, previous: {},
  });
  m.dashConversations.mockResolvedValue({ series: [{ day: "Mon", total: 4, resolved: 3, escalated: 1 }] });
  m.dashDomains.mockResolvedValue({ domains: [{ name: "database", count: 2, percentage: 100 }] });
  m.dashRecentConversations.mockResolvedValue({ conversations: [] });
  m.dashRecentTickets.mockResolvedValue({ tickets: [] });
  m.dashHealth.mockResolvedValue({ services: [], overall: "Healthy", down: [], security: {} });
  m.dashGateTrend.mockResolvedValue({ series: [] });
  l.getDashboardLayout.mockResolvedValue({ panels: [], custom: false, updated_at: null });
  l.saveDashboardLayout.mockImplementation(async (panels: any[]) => ({
    panels, custom: true, updated_at: "2026-11-08T10:00:00+00:00",
  }));
  l.resetDashboardLayout.mockResolvedValue({ panels: [], custom: false, updated_at: null });
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Dashboard role="admin" />); });
  await settle();
  await settle();
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) =>
    (b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase().includes(text.toLowerCase()),
  );
  if (!found) throw new Error(`no button matching "${text}" — have: ${
    [...el.querySelectorAll("button")].map((b) => b.textContent?.trim()).join(" | ")
  }`);
  return found as HTMLButtonElement;
}

function labelled(el: HTMLElement, label: string): HTMLElement {
  const found = el.querySelector(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no element labelled "${label}"`);
  return found as HTMLElement;
}

async function click(el: Element | null) {
  if (!el) throw new Error("click on null");
  await act(async () => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("Overview customization", () => {
  it("renders the default board and opens edit mode from Customize", async () => {
    const el = await mount();
    expect(el.textContent).toContain("Conversations over time");
    expect(el.textContent).toContain(`${DEFAULT_LAYOUT.length} panels · Default layout`);
    expect(el.textContent).not.toContain("Editing layout");

    await click(button(el, "Customize"));
    expect(el.textContent).toContain("Editing layout");
    expect(el.textContent).toContain("Add panel");
    expect(el.textContent).toContain("changes apply when you save");
  });

  it("saves the EDITED draft, not the layout it started from", async () => {
    const el = await mount();
    await click(button(el, "Customize"));
    await click(labelled(el, "Remove Needs attention"));

    expect(el.textContent).toContain(`${DEFAULT_LAYOUT.length - 1} panels`);
    await click(button(el, "Save layout"));

    expect(l.saveDashboardLayout).toHaveBeenCalledTimes(1);
    const saved = l.saveDashboardLayout.mock.calls[0][0] as any[];
    expect(saved).toHaveLength(DEFAULT_LAYOUT.length - 1);
    expect(saved.some((p) => p.type === "attention")).toBe(false);
    // Edit mode closes and the page says so instead of silently accepting the click.
    expect(el.textContent).not.toContain("Editing layout");
    expect(el.textContent).toContain("Layout saved for your account.");
    expect(el.textContent).toContain("Saved layout");
  });

  it("adds a note panel and keeps its text in the payload", async () => {
    const el = await mount();
    await click(button(el, "Customize"));
    await click(button(el, "Add panel"));

    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();

    const select = dialog.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "note";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();

    const textarea = dialog.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Runbook: https://wiki.example/db-restore");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();

    await click(button(dialog, "Add panel"));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.textContent).toContain("Runbook: https://wiki.example/db-restore");

    await click(button(el, "Save layout"));
    const saved = l.saveDashboardLayout.mock.calls[0][0] as any[];
    const note = saved.find((p) => p.type === "note");
    expect(note).toBeTruthy();
    expect(note.options.body).toContain("db-restore");
  });

  it("restores a saved layout on load instead of the default board", async () => {
    l.getDashboardLayout.mockResolvedValue({
      custom: true,
      updated_at: "2026-11-08T10:00:00+00:00",
      panels: [{ id: "n1", type: "note", title: "On-call", span: 12, options: { body: "Rotate the key on Monday." } }],
    });
    const el = await mount();

    expect(el.textContent).toContain("Rotate the key on Monday.");
    expect(el.textContent).toContain("On-call");
    expect(el.textContent).toContain("1 panels · Saved layout");
    expect(el.textContent).not.toContain("Conversations over time");
    expect(el.querySelectorAll("[data-panel-type]")).toHaveLength(1);
  });

  it("resets a customized board back to the default and says so", async () => {
    l.getDashboardLayout.mockResolvedValue({
      custom: true,
      updated_at: "2026-11-08T10:00:00+00:00",
      panels: [{ id: "n1", type: "note", title: "Only panel", span: 6, options: { body: "x" } }],
    });
    const el = await mount();
    await click(button(el, "Customize"));
    await click(button(el, "Reset"));

    expect(l.resetDashboardLayout).toHaveBeenCalledTimes(1);
    expect(el.textContent).toContain("Reset to the default layout.");
    expect(el.textContent).toContain(`${DEFAULT_LAYOUT.length} panels · Default layout`);
    expect(el.textContent).toContain("Conversations over time");
  });

  it("renders a panel typed by an older deployment as a labelled placeholder, not a crash", async () => {
    l.getDashboardLayout.mockResolvedValue({
      custom: true,
      updated_at: "2026-11-08T10:00:00+00:00",
      panels: [{ id: "x1", type: "sankey-of-doom", title: "Mystery", span: 6, options: {} }],
    });
    const el = await mount();
    expect(el.textContent).toContain("Mystery");
    expect(el.textContent).toContain("This panel type is not available in this build");
  });
});
