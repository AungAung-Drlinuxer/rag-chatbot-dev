/**
 * KnowledgePage — the KB article browser.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component; the logic
 * that decides what the user SEES is all render-time — the loading / error / empty /
 * no-match / has-rows branches of one table, the result count, and the filter summary.
 *
 * The failure this guards: a failed `listArticles` used to leave an empty table behind a
 * transient toast, which reads as "you have no articles" rather than "the request failed";
 * and the "nothing here yet" vs "nothing matches" empty states are only correct if they
 * carry different actions. Both are asserted below.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act() + direct DOM
 * queries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/knowledge/api", () => ({
  searchArticles: vi.fn(),
  triggerSync: vi.fn(),
  listArticleDomains: vi.fn(),
  getSyncStatus: vi.fn(),
  listArticles: vi.fn(),
  bulkMoveArticles: vi.fn(),
  bulkDeleteArticles: vi.fn(),
  createArticle: vi.fn(),
  updateArticle: vi.fn(),
  deleteArticle: vi.fn(),
  articleDraft: vi.fn(),
  listRecentArticles: vi.fn(),
  listArticleSources: vi.fn(),
  listArticleSpaces: vi.fn(),
}));

vi.mock("@/features/domains/api", () => ({
  getClassifierDomains: vi.fn(),
}));

import * as kbApi from "@/features/knowledge/api";
import * as domainsApi from "@/features/domains/api";
import Knowledge from "./KnowledgePage";


const m = kbApi as unknown as Record<string, any>;
const domains = domainsApi as unknown as Record<string, any>;

const iso = () => new Date().toISOString();

const CLASSIFIER_DOMAINS = [
  {
    id: 1, domain_key: "database", display_name: "Database",
    description: "PostgreSQL, Oracle, SQL, deadlocks, performance", keywords: [],
    jira_project: null, jira_assignee: null, is_active: true, created_at: null, updated_at: null,
  },
];

function article(over: Record<string, any> = {}) {
  return {
    page_id: "kb-1",
    title: "Restart nginx safely",
    domain: "database",
    source_url: "https://aungaungxero.atlassian.net/wiki/spaces/IT/pages/1",
    updated_by: "alice",
    last_synced: iso(),
    ...over,
  };
}

function happyPath() {
  domains.getClassifierDomains.mockResolvedValue({ domains: CLASSIFIER_DOMAINS });
  m.listArticleDomains.mockResolvedValue({
    domains: [{ domain: "database", display_name: "Database", pages: 12, last_synced: iso(), description: "PostgreSQL, Oracle, SQL, deadlocks, performance" }],
  });
  m.getSyncStatus.mockResolvedValue({ pages: 12, state: "done", last_run: { at: iso(), pages: 12, inserted: 1, updated: 2, skipped: 9 }, healthy: true, beat_interval_minutes: 30 });
  m.listArticles.mockResolvedValue({ articles: [article()], total: 3 });
  // One provider genuinely contributed rows. The old figure was the length of a hardcoded
  // array, which reported "2 sources" on an install where only Confluence was configured.
  m.listArticleSources.mockResolvedValue({ sources: [{ key: "confluence", label: "Confluence", count: 12 }] });
  m.listArticleSpaces.mockResolvedValue({ spaces: [{ key: "IHKB", count: 12 }] });
  m.searchArticles.mockResolvedValue({ data: { articles: [{ title: "VPN fix", domain: "database", source_url: "" }] } });
  m.triggerSync.mockResolvedValue({ status: 200, data: { queued: true } });
  m.bulkMoveArticles.mockResolvedValue({ status: 200, data: { moved: 1 } });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onToast = vi.fn();

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

async function mount(role = "admin") {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Knowledge role={role} userName="alice" onToast={onToast} />); });
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

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
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

describe("KnowledgePage — header, results and rows", () => {
  it("renders the page header and the real KB total from COUNT(*)", async () => {
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("Knowledge Base Articles");
    expect(text).toContain("Administrator");
    // kbTotal (3) is the API's COUNT(*), not the loaded page size (1).
    expect(text).toContain("3 articles in the knowledge base");
  });

  it("renders an article row with its title, provider badge and domain", async () => {
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("Restart nginx safely");
    expect(text).toContain("Confluence"); // resolved from the atlassian.net host
    expect(text).toContain("Database");
    expect(text).toContain("Sorted by Synced");
    expect(el.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("shows 'Loading articles…' and a skeleton while the list is in flight", async () => {
    m.listArticles.mockReturnValue(new Promise(() => {}));
    const el = await mount("admin");
    expect(el.textContent).toContain("Loading articles…");
    expect(el.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(1);
  });

  it("shows the sync-health chip from /sync-status", async () => {
    const healthy = await mount("admin");
    expect(healthy.textContent).toContain("KB Synced");

    m.getSyncStatus.mockResolvedValue({ pages: 12, state: "idle", last_run: null, healthy: false, beat_interval_minutes: 30 });
    const stale = await mount("admin");
    expect(stale.textContent).toContain("Sync Pending");
  });

  it("reports the four measured figures in the facts strip", async () => {
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("Articles");
    expect(text).toContain("Domains");
    expect(text).toContain("Sources");
    expect(text).toContain("Last sync");
    // Derived from the rows that exist — never from a fixed provider list, which used to
    // report two sources even when only one integration was configured.
    expect(text).toContain("With indexed articles");
    expect(text).toContain("1");
    expect(text).toContain("Runs every 30 min");
  });
});

describe("KnowledgePage — empty, no-match and error", () => {
  it("shows the 'no articles yet' state (no clear action) on an empty KB", async () => {
    m.listArticles.mockResolvedValue({ articles: [], total: 0 });
    const el = await mount("admin");
    expect(el.textContent).toContain("No articles yet");
    expect(button(el, "Clear filters")).toBeUndefined();
  });

  it("shows a distinct 'no match' state WITH Clear filters when the KB is non-empty", async () => {
    m.listArticles.mockResolvedValue({ articles: [], total: 229 });
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("No articles match this filter");
    expect(text).toContain("229 articles in the knowledge base, but none match the current filters.");
    expect(button(el, "Clear filters")).toBeTruthy();
  });

  it("NEVER renders an empty state when the request fails — it renders an error", async () => {
    m.listArticles.mockRejectedValue(new Error("articles 500"));
    const el = await mount("admin");
    expect(el.textContent).toContain("Could not load the knowledge base");
    expect(el.textContent).toContain("articles 500");
    expect(el.textContent).toContain("Could not load articles");
    expect(el.textContent).not.toContain("No articles yet");
    expect(onToast).toHaveBeenCalledWith("Failed to load article list", "err");
  });
});

describe("KnowledgePage — filters, search and sync", () => {
  it("summarises active filters with removable pills and a Clear all", async () => {
    const el = await mount("admin");
    const chip = button(el, "Database")!; // the domain chip
    await click(chip);
    const text = el.textContent!;
    expect(text).toContain("Filtered by");
    expect(text).toContain("Clear all");
    expect(el.querySelector('[aria-label="Remove filter Database"]')).toBeTruthy();
  });

  it("runs a keyword search and reports the hit count", async () => {
    const el = await mount("admin");
    const input = el.querySelector('input[aria-label="Search the knowledge base"]') as HTMLInputElement;
    await typeInto(input, "vpn");
    await click(button(el, "Search"));
    expect(m.searchArticles).toHaveBeenCalledWith("vpn", undefined);
    expect(onToast).toHaveBeenCalledWith("1 search results found");
    expect(el.textContent).toContain("VPN fix");
  });

  it("triggers a KB sync and reloads the list", async () => {
    const el = await mount("admin");
    await click(button(el, "Sync now"));
    expect(m.triggerSync).toHaveBeenCalled();
    expect(onToast).toHaveBeenCalledWith(expect.stringContaining("Knowledge base synced"));
  });

  it("flags General-IT stragglers and description-less domains for review", async () => {
    m.listArticleDomains.mockResolvedValue({
      domains: [
        { domain: "general", display_name: "General IT", pages: 5, description: "short" },
        { domain: "database", display_name: "Database", pages: 12, description: "PostgreSQL, Oracle, SQL, deadlocks, performance" },
      ],
    });
    const text = (await mount("admin")).textContent!;
    expect(text).toContain("Needs review");
    expect(text).toContain("5 articles sit in General IT");
    expect(text).toContain("fallback bucket");
    expect(text).toContain("1 domain have no description");
  });
});
