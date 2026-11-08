/**
 * TicketsPage — the support-request queue.
 *
 * WHY RENDER INSTEAD OF UNIT-TEST HELPERS: the page exports only its component; the parts
 * that can fail silently are its render branches — loading vs empty vs error vs
 * filtered-to-nothing, and the sort/filter state that decides WHICH rows are on screen.
 *
 * The failure this guards: a failed `listTickets` used to fall through to the EMPTY state,
 * so a dead backend told the user "No tickets found — try changing your search or filter
 * criteria", sending them to fiddle with filters that were never the problem. Error and
 * empty are now different screens and the test pins that.
 *
 * Harness: no @testing-library by choice, so react-dom/client inside act() + direct DOM
 * queries (see ScopeControl.test.tsx / MarkdownMessage.test.tsx for the same spirit).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/tickets/api", () => ({
  listTickets: vi.fn(),
  listTicketDestinations: vi.fn(),
  syncJiraTickets: vi.fn(),
  listActiveDomains: vi.fn(),
  createTicketApi: vi.fn(),
  ticketComments: vi.fn(),
  ticketAddComment: vi.fn(),
  ticketUpdate: vi.fn(),
  ticketAttachments: vi.fn(),
  ticketAttachmentAdd: vi.fn(),
  attachmentUrl: (ref: string, id: number) => `/api/tickets/${ref}/attachments/${id}/download`,
}));

vi.mock("@/features/knowledge/api", () => ({ articleDraft: vi.fn() }));
vi.mock("@/features/users/api", () => ({ assignableUsers: vi.fn() }));

import * as ticketsApi from "@/features/tickets/api";
import * as knowledgeApi from "@/features/knowledge/api";
import * as usersApi from "@/features/users/api";
import Tickets from "./TicketsPage";

const m = ticketsApi as unknown as Record<string, any>;
const knowledge = knowledgeApi as unknown as Record<string, any>;
const users = usersApi as unknown as Record<string, any>;

const nowIso = () => new Date().toISOString();

function ticket(over: Record<string, any>) {
  return {
    id: "IT-1",
    subject: "VPN down",
    description: "Cannot reach the VPN gateway.",
    status: "open",
    priority: "high",
    category: "Network",
    requester: "alice",
    assignee: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    ...over,
  };
}

const TICKETS = [
  ticket({ id: "IT-1", subject: "VPN down", status: "open", priority: "high", requester: "alice" }),
  ticket({ id: "IT-2", subject: "Printer jam", status: "pending", priority: "medium", requester: "bob", assignee: "carol" }),
  ticket({ id: "IT-3", subject: "DB slow", status: "done", priority: "critical", requester: "dave" }),
];

function happyPath() {
  m.listTickets.mockResolvedValue({ tickets: TICKETS });
  m.listTicketDestinations.mockResolvedValue([{ key: "jira", label: "Jira", configured: true }]);
  m.listActiveDomains.mockResolvedValue([]);
  m.ticketComments.mockResolvedValue({ comments: [] });
  m.ticketAttachments.mockResolvedValue({ attachments: [] });
  users.assignableUsers.mockResolvedValue({ users: [{ username: "carol", email: null, role: "agent" }] });
  knowledge.articleDraft.mockResolvedValue({ draft: "AI generated description" });
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
  await act(async () => { root!.render(<Tickets role={role} userName="alice" onToast={onToast} />); });
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

describe("TicketsPage — loading, data and stats", () => {
  it("shows skeleton rows while the list request is still in flight", async () => {
    m.listTickets.mockReturnValue(new Promise(() => {})); // never resolves
    const el = await mount("admin");
    expect(el.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(6);
    expect(el.textContent).not.toContain("VPN down");
  });

  it("renders one row per ticket with status, priority and requester", async () => {
    const el = await mount("admin");
    expect(rowCount(el)).toBe(3);
    const text = el.textContent!;
    expect(text).toContain("IT-1");
    expect(text).toContain("VPN down");
    expect(text).toContain("Open");
    expect(text).toContain("High");
    expect(text).toContain("alice");
    expect(text).toContain("Printer jam");
    expect(text).toContain("Unassigned");
    expect(text).toContain("carol");
  });

  it("counts total / open / pending / in progress / done from the loaded list", async () => {
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("Total tickets");
    expect(text).toContain("Open");
    expect(text).toContain("Pending");
    expect(text).toContain("In progress");
    expect(text).toContain("Done");
    // The three stat figures 3,1,1,1 appear somewhere in the KPI cards.
    const cards = el.querySelectorAll('[data-slot="card"]');
    const kpi = [...cards].slice(0, 4).map((c) => c.textContent);
    expect(kpi.join(" ")).toContain("3");
    expect(el.textContent).toContain("3 matching tickets");
  });

  it("reports the loaded row count in the results heading", async () => {
    const el = await mount("admin");
    expect(el.textContent).toContain("3 matching tickets");
    expect(el.textContent).toContain("Showing all 3 tickets");
  });
});

describe("TicketsPage — empty vs error vs filtered-to-nothing", () => {
  it("shows the integration empty state (no Clear filters) when there are NO tickets", async () => {
    m.listTickets.mockResolvedValue({ tickets: [] });
    const el = await mount("admin");
    const text = el.textContent!;
    expect(text).toContain("No tickets yet");
    expect(text).toContain("Jira");
    expect(button(el, "Clear filters")).toBeUndefined();
  });

  it("shows a distinct 'no match' state with Clear filters when a filter hides everything", async () => {
    const el = await mount("admin");
    const search = el.querySelector('input[aria-label="Search tickets"]') as HTMLInputElement;
    await typeInto(search, "zzz-no-such-ticket");
    expect(el.textContent).toContain("No tickets found");
    expect(el.textContent).toContain("Try changing your search or filter criteria");

    const clear = button(el, "Clear filters");
    expect(clear).toBeTruthy();
    await click(clear);
    expect(rowCount(el)).toBe(3);
  });

  it("NEVER renders the empty state when the request fails — it renders an error", async () => {
    m.listTickets.mockRejectedValue(new Error("tickets 500"));
    const el = await mount("admin");
    expect(el.textContent).toContain("Could not load tickets");
    expect(el.textContent).toContain("tickets 500");
    expect(el.textContent).not.toContain("No tickets found");
    expect(el.textContent).not.toContain("No tickets yet");
    expect(button(el, "Try again")).toBeTruthy();
  });
});

describe("TicketsPage — filtering and sorting", () => {
  it("narrows the rows to a search term", async () => {
    const el = await mount("admin");
    const search = el.querySelector('input[aria-label="Search tickets"]') as HTMLInputElement;
    await typeInto(search, "printer");
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("1 matching tickets");
  });

  it("narrows the rows to a status filter", async () => {
    const el = await mount("admin");
    // Status is a segmented switch now, not a <select>: every state is visible with its count.
    const group = el.querySelector('[role="group"][aria-label="Filter by status"]') as HTMLElement;
    const done = [...group.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Done"),
    ) as HTMLElement;
    await click(done);
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("DB slow");
  });

  it("lets the 'Open' KPI card act as a one-click status filter", async () => {
    const el = await mount("admin");
    const openCard = [...el.querySelectorAll('[role="button"]')].find((c) =>
      c.textContent?.includes("Open"),
    ) as HTMLElement;
    await click(openCard);
    expect(rowCount(el)).toBe(1);
    expect(el.textContent).toContain("VPN down");
  });

  it("toggles column sort direction and advertises it via aria-sort", async () => {
    const el = await mount("admin");
    const header = button(el, "Ticket")!;
    expect(header.getAttribute("aria-sort")).toBe("none");
    await click(header);
    expect(button(el, "Ticket")!.getAttribute("aria-sort")).toBe("descending");
    await click(button(el, "Ticket"));
    expect(button(el, "Ticket")!.getAttribute("aria-sort")).toBe("ascending");
  });
});

describe("TicketsPage — detail panel and create dialog", () => {
  it("opens the detail panel for the clicked ticket", async () => {
    const el = await mount("admin");
    expect(el.textContent).toContain("No ticket selected");
    await click(button(el, "IT-1"));
    const text = el.textContent!;
    expect(text).not.toContain("No ticket selected");
    expect(text).toContain("VPN down");
    expect(text).toContain("Cannot reach the VPN gateway.");
    // The control is now the Jira workflow rail: four labelled steps on one track.
    expect(text).toContain("Jira workflow");
    expect(text).toContain("click a step to move it");
    for (const step of ["Open", "Pending", "In progress", "Done"]) expect(text).toContain(step);
  });

  it("opens the create dialog and refuses to create a ticket with no subject", async () => {
    const el = await mount("admin");
    await click(button(el, "Create ticket"));
    expect(document.body.textContent).toContain("Create support ticket");
    expect(document.body.textContent).toContain("Create in");

    // Footer "Create ticket" with an empty subject must toast, not call the API.
    const dialog = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    const dialogCreate = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Create ticket"),
    );
    await click(dialogCreate);
    expect(onToast).toHaveBeenCalledWith("Ticket subject is required", "err");
    expect(m.createTicketApi).not.toHaveBeenCalled();
  });

  it("creates a ticket and prepends it to the table", async () => {
    m.createTicketApi.mockResolvedValue({ id: "IT-99", subject: "New issue" });
    const el = await mount("admin");
    await click(button(el, "Create ticket"));
    const subject = document.querySelector('input[aria-label="Subject"]') as HTMLInputElement;
    await typeInto(subject, "New issue");
    const dialog = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    const dialogCreate = [...dialog.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Create ticket"),
    );
    await click(dialogCreate);
    expect(m.createTicketApi).toHaveBeenCalled();
    expect(el.textContent).toContain("IT-99");
    expect(onToast).toHaveBeenCalledWith("Ticket created in Jira");
  });

  it("keeps the workflow read-only when Jira is not configured", async () => {
    m.listTicketDestinations.mockResolvedValue([
      { key: "jira", label: "Jira", configured: false },
    ]);
    const el = await mount("admin");
    await click(button(el, "IT-1"));
    const text = el.textContent!;
    expect(text).toContain("read-only until Jira is connected");
    expect(text).toContain("Jira is not connected");
    const pane = el.querySelector('aside[aria-label="Ticket detail"]') as HTMLElement;
    const step = [...pane.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Pending",
    ) as HTMLButtonElement;
    expect(step.disabled).toBe(true);
  });
});
