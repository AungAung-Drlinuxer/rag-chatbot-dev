/**
 * ConversationHistoryPage — the admin conversation browser.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component, and every
 * decision worth guarding is a render-time branch — the four table columns, the count
 * badge, the transcript panel's export pair, and the empty-vs-error split. So the test
 * mounts the real component against mocked feature APIs and reads the DOM.
 *
 * The failure this guards: a failed `adminListConversations` used to fall through to the
 * EMPTY state, so a dead backend told the admin "No conversations yet" — the same wrong
 * screen the tickets page had. Error and empty are different screens and this pins that.
 *
 * Harness note: the repo has no @testing-library by choice, so this uses react-dom/client
 * inside act() and queries the DOM directly (same spirit as TicketsPage.test.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/conversations/admin-api", () => ({
  adminListConversations: vi.fn(),
  adminConversationMessages: vi.fn(),
  adminDownloadConversation: vi.fn(),
}));

vi.mock("@/features/users/api", () => ({ listUsers: vi.fn() }));

import * as adminApi from "@/features/conversations/admin-api";
import * as usersApi from "@/features/users/api";
import Page from "./ConversationHistoryPage";

const m = adminApi as unknown as Record<string, any>;
const users = usersApi as unknown as Record<string, any>;

const CONVS = [
  {
    session_id: "s1",
    username: "ith@dmin",
    title: "Reset my password and re-sync my MFA token?",
    messages: 6,
    started_at: "2026-11-01T22:10:00Z",
    last_at: "2026-11-01T22:11:00Z",
  },
  {
    session_id: "s2",
    username: "AungAung",
    title: "Database is down",
    messages: 4,
    started_at: "2026-11-01T20:40:00Z",
    last_at: "2026-11-01T20:48:00Z",
  },
];

const MESSAGES = [
  { role: "user", content: "How do I reset my password?", created_at: "2026-11-01T22:10:00Z" },
  { role: "assistant", content: "Contact IT support for assistance.", created_at: "2026-11-01T22:11:00Z" },
];

function happyPath() {
  m.adminListConversations.mockResolvedValue({ conversations: CONVS });
  m.adminConversationMessages.mockResolvedValue({ username: "ith@dmin", messages: MESSAGES });
  m.adminDownloadConversation.mockResolvedValue({ blob: () => Promise.resolve(new Blob()) });
  users.listUsers.mockResolvedValue({ users: [{ username: "ith@dmin" }, { username: "AungAung" }] });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Page />); });
  await settle();
  return container;
}

const button = (el: ParentNode, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

async function click(el: Element | undefined | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

const headers = (el: ParentNode) =>
  [...el.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
const rowCount = (el: ParentNode) => el.querySelectorAll("tbody tr").length;

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

describe("ConversationHistoryPage — header, figures and toolbar", () => {
  it("renders the page title, subtitle, three figures and the filter bar", async () => {
    const el = await mount();
    const text = el.textContent!;
    expect(text).toContain("Conversation history");
    expect(text).toContain("Review conversations, explore transcripts, and keep context in one place.");
    expect(text).toContain("Conversations");
    expect(text).toContain("Total messages");
    expect(text).toContain("Active users");
    expect(text).toContain("Reset");
    expect(el.querySelector('input[aria-label="Search conversations"]')?.getAttribute("placeholder"))
      .toBe("Search conversation or user...");
    // 2 conversations / 10 messages / 2 distinct users, all counted from the loaded list.
    expect(text).toContain("10");
    expect(text).toContain("2");
  });
});

describe("ConversationHistoryPage — the table", () => {
  it("shows the four core columns plus the answering provider", async () => {
    const el = await mount();
    expect(headers(el)).toEqual(["User", "Conversation", "Msgs", "Provider", "Last activity"]);
    expect(rowCount(el)).toBe(2);
    const text = el.textContent!;
    expect(text).toContain("ith@dmin");
    expect(text).toContain("Reset my password and re-sync my MFA token?");
    expect(text).toContain("AungAung");
    expect(text).toContain("Database is down");
  });

  it("reports the loaded row count in the section badge and the footer", async () => {
    const el = await mount();
    expect(el.querySelector("h2")?.textContent).toContain("Conversations");
    expect(el.querySelector("h2")?.textContent).toContain("2");
    expect(el.textContent).toContain("Showing 2 of 2 conversations");
  });

  it("narrows the rows to a search term and says so in the footer", async () => {
    const el = await mount();
    const search = el.querySelector('input[aria-label="Search conversations"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set;
      setter!.call(search, "database");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("Showing 1 of 2 conversations (filtered)");
  });
});

describe("ConversationHistoryPage — empty vs error", () => {
  it("shows the empty state (no Clear filters) when there are no conversations at all", async () => {
    m.adminListConversations.mockResolvedValue({ conversations: [] });
    const el = await mount();
    expect(el.textContent).toContain("No conversations yet");
    expect(button(el, "Clear filters")).toBeUndefined();
  });

  it("shows a distinct 'no match' state with Clear filters when a filter hides everything", async () => {
    const el = await mount();
    const search = el.querySelector('input[aria-label="Search conversations"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set;
      setter!.call(search, "zzz-no-such-conversation");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(el.textContent).toContain("No conversations match these filters");
    const clear = button(el, "Clear filters");
    await click(clear);
    expect(rowCount(el)).toBe(2);
  });

  it("NEVER renders the empty state when the request fails — it renders an error", async () => {
    m.adminListConversations.mockRejectedValue(new Error("conversations 500"));
    const el = await mount();
    expect(el.textContent).toContain("Could not load conversation history");
    expect(el.textContent).toContain("conversations 500");
    expect(el.textContent).not.toContain("No conversations yet");
    expect(button(el, "Try again")).toBeTruthy();
  });
});

describe("ConversationHistoryPage — transcript panel", () => {
  it("starts with the transcript dialog closed and no placeholder column", async () => {
    const el = await mount();
    // The permanent "Select a conversation" rail is gone: nothing is rendered until a row
    // is opened, so the list owns the full width.
    expect(document.body.textContent).not.toContain("Select a conversation");
    expect(document.body.textContent).not.toContain("Export .txt");
    expect(el.textContent).toContain("Conversations");
  });

  it("opens the transcript with its meta line, both exports and the messages", async () => {
    const el = await mount();
    await click(el.querySelector("tbody tr"));
    // The transcript is a dialog, rendered through a portal — assert on the document.
    const text = document.body.textContent!;
    expect(text).toContain("Conversation transcript");
    expect(text).toContain("Reset my password and re-sync my MFA token?");
    expect(text).toContain("6 messages");
    expect(text).toContain("Export .txt");
    expect(text).toContain("Export .json");
    expect(text).toContain("How do I reset my password?");
    expect(text).toContain("IT Assistant");
    expect(text).toContain("Contact IT support for assistance.");
    expect(text).not.toContain("Select a conversation");
  });

  it("reports a failed transcript fetch instead of leaving the previous one on screen", async () => {
    m.adminConversationMessages.mockRejectedValue(new Error("messages 500"));
    const el = await mount();
    await click(el.querySelector("tbody tr"));
    expect(document.body.textContent).toContain("Could not load this transcript");
    expect(document.body.textContent).toContain("messages 500");
  });
});
