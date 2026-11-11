/**
 * The one create-ticket form.
 *
 * The chat answer's "Create Jira ticket" used to open a two-field dialog of its own, so the
 * same button produced a weaker ticket (priority pinned to medium, no category, assignee, due
 * date or attachments). These tests pin that the shared form is what opens, that a message's
 * text arrives as a preset, and that the payload matches the Tickets page's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/tickets/api", () => ({
  createTicketApi: vi.fn(),
  ticketAttachmentAdd: vi.fn(),
  ticketAssignees: vi.fn(),
  listActiveDomains: vi.fn(),
  listTicketDestinations: vi.fn(),
  improveTicketDescription: vi.fn(),
}));
vi.mock("@/features/users/api", () => ({ assignableUsers: vi.fn() }));

import * as ticketsApi from "@/features/tickets/api";
import * as usersApi from "@/features/users/api";
import { CreateTicketDialog } from "@/features/tickets/components/CreateTicketDialog";

const m = ticketsApi as unknown as Record<string, any>;
const u = usersApi as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function mount(preset?: { subject?: string; description?: string; sessionId?: string }) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<CreateTicketDialog open onOpenChange={() => {}} preset={preset} onToast={() => {}} />);
  });
  await settle();
  // Dialog content is portaled to <body>, outside the mount container.
  return document.body;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.listActiveDomains.mockResolvedValue([
    { key: "general", label: "General" },
    { key: "network", label: "Network" },
  ]);
  m.listTicketDestinations.mockResolvedValue([{ key: "jira", label: "Jira", configured: true }]);
  m.ticketAssignees.mockResolvedValue({
    domain: "general", configured: false,
    assignees: [{ username: "alice", group: null }, { username: "bob", group: null }],
    default: "alice",
  });
  m.createTicketApi.mockResolvedValue({ id: "IT-99", subject: "VPN down" });
  u.assignableUsers.mockResolvedValue({ users: [{ username: "alice", role: "admin" }] });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("CreateTicketDialog", () => {
  it("carries every field the Tickets page form has", async () => {
    const el = await mount();
    const text = el.textContent!;
    expect(text).toContain("Create ticket");
    expect(text).toContain("Improve with AI");
    for (const label of ["Subject", "Description", "Category", "Priority", "Assignee", "Due date", "Attachments"]) {
      expect(text).toContain(label);
    }
    expect(el.querySelector('select[aria-label="Priority"]')).toBeTruthy();
    expect(el.querySelector('select[aria-label="Assignee"]')).toBeTruthy();
    expect(el.querySelector('input[aria-label="Due date"]')).toBeTruthy();
    expect(el.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("starts from the chat message when a preset is given", async () => {
    const el = await mount({ subject: "How do I reset my VPN?", description: "The answer that was given." });
    expect((el.querySelector('input[aria-label="Subject"]') as HTMLInputElement).value).toBe("How do I reset my VPN?");
    expect((el.querySelector('textarea[aria-label="Ticket description"]') as HTMLTextAreaElement).value).toBe("The answer that was given.");
  });

  it("sends the same payload shape as the Tickets page, including the session link", async () => {
    const el = await mount({ subject: "VPN down", description: "gateway unreachable", sessionId: "11111111-1111-1111-1111-111111111111" });
    setValue(el.querySelector('select[aria-label="Priority"]') as HTMLSelectElement, "high");
    setValue(el.querySelector('select[aria-label="Category"]') as HTMLSelectElement, "Network");

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create ticket")) as HTMLButtonElement;
    await act(async () => { submit.click(); });
    await settle();

    expect(m.createTicketApi).toHaveBeenCalledTimes(1);
    expect(m.createTicketApi.mock.calls[0][0]).toMatchObject({
      subject: "VPN down",
      description: "gateway unreachable",
      domain: "network",
      priority: "high",
      destination: "jira",
      session_id: "11111111-1111-1111-1111-111111111111",
    });
  });

  it("is the dialog the chat opens — no second, smaller form", () => {
    const chat = readFileSync(resolve(process.cwd(), "src/features/chat/pages/ChatPage.tsx"), "utf8");
    expect(chat).toContain("<CreateTicketDialog");
    // The old inline dialog titled the form "Create Jira ticket" with only two fields.
    expect(chat).not.toContain("Create Jira ticket</DialogTitle>");
    expect(chat).not.toContain("createTicketApi");
    // One door: the header button and the rail action are gone.
    expect(chat).not.toContain("Escalate to IT");
  });

  it("opens empty — the reporter writes the subject and description", async () => {
    const el = await mount();
    expect((el.querySelector('input[aria-label="Subject"]') as HTMLInputElement).value).toBe("");
    expect((el.querySelector('textarea[aria-label="Ticket description"]') as HTMLTextAreaElement).value).toBe("");
  });

  it("improves what the reporter typed instead of generating a description", async () => {
    m.improveTicketDescription.mockResolvedValue("VPN drops every few minutes on the 3rd floor; reconnecting restores it briefly.");
    const el = await mount();

    const improve = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Improve with AI",
    ) as HTMLButtonElement;
    expect(improve.disabled).toBe(true); // nothing to improve yet

    setValue(el.querySelector('textarea[aria-label="Ticket description"]') as HTMLTextAreaElement,
      "vpn keeps dropping on 3rd floor, reconnect fixes it for a bit");
    await settle();
    expect(improve.disabled).toBe(false);

    await act(async () => { improve.click(); });
    await settle();

    expect(m.improveTicketDescription).toHaveBeenCalledWith(
      "vpn keeps dropping on 3rd floor, reconnect fixes it for a bit",
      "",
    );
    expect((el.querySelector('textarea[aria-label="Ticket description"]') as HTMLTextAreaElement).value)
      .toContain("VPN drops every few minutes");
  });


  it("narrows the assignee list to the chosen category", async () => {
    m.ticketAssignees.mockImplementation((domain: string) =>
      domain === "network"
        ? Promise.resolve({
            domain: "network",
            configured: true,
            assignees: [
              { username: "carol", group: "Network Team" },
              { username: "dave", group: "NOC" },
            ],
            default: "carol",
          })
        : Promise.resolve({
            domain: "general",
            configured: false,
            assignees: [{ username: "alice", group: null }],
            default: "alice",
          }),
    );

    const el = await mount();
    const select = el.querySelector('select[aria-label="Assignee"]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("alice");

    setValue(el.querySelector('select[aria-label="Category"]') as HTMLSelectElement, "Network");
    await settle();

    expect(m.ticketAssignees).toHaveBeenCalledWith("network");
    const labels = [...select.querySelectorAll("optgroup")].map((g) => g.getAttribute("label"));
    expect(labels).toEqual(["Network Team", "NOC"]);
    expect([...select.options].map((o) => o.value)).toEqual(["", "carol", "dave"]);
    // The category's default person is preselected, so a network ticket is never unowned.
    expect(select.value).toBe("carol");
    expect(el.textContent).toContain("Only people mapped to Network can be picked.");
  });
});
