/**
 * PageSidebar — the workspace menu is filtered by capability, not greyed out.
 *
 * The failure this guards: a plain User used to see Knowledge / Domains & Routing /
 * Users / Conversations / Audit Log as locked rows. The role model says those entries do
 * not belong to them at all, so they must never be in the DOM (a rail of padlocks reads
 * as a broken app, and the page-level guard in App.tsx already answers a deep link).
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act() + direct DOM
 * queries — same pattern as UsersPage.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/NotificationBell", async (orig) => {
  const real = await orig<typeof import("@/components/NotificationBell")>();
  return {
    ...real,
    useNotifications: () => ({ notices: [], error: null, refresh: () => {} }),
    NotificationBell: () => null,
  };
});

vi.mock("@/features/conversations/api", () => ({
  listConversations: () => Promise.resolve({ conversations: [] }),
  deleteConversation: () => Promise.resolve({}),
  clearConversations: () => Promise.resolve({}),
  renameConversation: () => Promise.resolve({}),
  pinConversation: () => Promise.resolve({}),
}));

vi.mock("@/app/useBranding", () => ({
  useBranding: () => ({ appName: "IT Help Chatbot", short: "iTH" }),
}));

import PageSidebar from "./PageSidebar";

const USER = {
  chatbot: true, kb_search: true, create_tickets: true,
  manage_kb: false, manage_users: false, manage_domains: false,
};
const KNOWLEDGE = { ...USER, manage_kb: true, manage_domains: true };
const ADMIN = {
  chatbot: true, kb_search: true, create_tickets: true,
  manage_kb: true, manage_users: true, manage_domains: true,
};

const ALL = ["Chat", "Overview", "Knowledge", "Domains & Routing", "Tickets", "Users",
             "Conversations", "Audit Log", "Settings"];

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

async function mount(perms?: Record<string, boolean>) {
  await act(async () => {
    root.render(
      <PageSidebar active="chat" onNavigate={() => {}} userName="probe" role="user" perms={perms} />,
    );
  });
}

/** Workspace nav buttons in DOM order (the chat list has no matching labels). */
function navLabels(): string[] {
  return [...host.querySelectorAll("button")]
    .map((b) => (b.textContent || "").trim())
    .filter((t) => ALL.includes(t));
}

describe("PageSidebar — the menu follows the role", () => {
  it("a plain User sees only what a User can do", async () => {
    await mount(USER);
    expect(navLabels()).toEqual(["Chat", "Overview", "Tickets", "Settings"]);
    for (const gone of ["Knowledge", "Domains & Routing", "Users", "Conversations", "Audit Log"]) {
      expect(host.textContent).not.toContain(gone);
    }
  });

  it("a Knowledge Manager gains the KB and routing, not user administration", async () => {
    await mount(KNOWLEDGE);
    expect(navLabels()).toEqual([
      "Chat", "Overview", "Knowledge", "Domains & Routing", "Tickets", "Settings",
    ]);
    expect(host.textContent).not.toContain("Audit Log");
  });

  it("an Administrator sees every entry", async () => {
    await mount(ADMIN);
    expect(navLabels()).toEqual(ALL);
  });

  it("renders nothing capability-gated while permissions are still loading", async () => {
    // The menu used to paint every entry and then remove the forbidden ones a second
    // later — the "other pages flash, then disappear on refresh" bug. Nothing gated may
    // render before the answer is known.
    await mount(undefined);
    expect(navLabels()).toEqual(["Chat", "Overview", "Tickets", "Settings"]);
    expect(host.textContent).not.toContain("Knowledge");
  });
});
