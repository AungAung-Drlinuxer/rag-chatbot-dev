import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EditTicketDialog } from "@/features/tickets/components/EditTicketDialog";
import type { Ticket } from "@/features/tickets/model";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SAMPLE_TICKET: Ticket = {
  id: "IT-1",
  subject: "Cannot access internal VPN",
  description: "VPN gateway error 403 on client connect",
  status: "pending",
  priority: "high",
  category: "Network",
  requester: "ith@admin",
  assignee: "alice",
  due_date: "2026-12-01",
  created_at: "2026-11-11T00:41:10Z",
  updated_at: "2026-11-11T02:00:00Z",
};

const COMMENT = {
  id: 1,
  author: "ith@admin",
  body: "Status moved to Pending",
  kind: "status",
  created_at: "2026-11-11T00:42:00Z",
};

describe("EditTicketDialog", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function mount(ui: React.ReactNode) {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(ui); });
    return container;
  }

  function dialog() {
    return document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
  }

  const props = {
    open: true,
    ticket: SAMPLE_TICKET,
    comments: [COMMENT],
    attachments: [],
    assignable: [{ username: "alice", email: "alice@example.com", role: "admin" }],
    jiraReady: true,
    onSave: async () => true,
    onStatus: async () => true,
    onAddAttachment: () => {},
    onDeleteAttachment: () => {},
  };

  it("opens on Details with the ticket's own values and a Jira sync badge", async () => {
    await mount(
      <EditTicketDialog {...props} onOpenChange={vi.fn()} />,
    );

    const text = document.body.textContent ?? "";
    expect(text).toContain("Edit ticket");
    expect(text).toContain("IT-1");
    expect(text).toContain("Jira synced");

    // The two tabs the design asks for.
    expect(text).toContain("Details");
    expect(text).toContain("Activity");

    // Details carries the editable fields, filled from the ticket.
    expect((document.querySelector("#ticket-subject") as HTMLInputElement).value)
      .toBe("Cannot access internal VPN");
    expect((document.querySelector("#ticket-description") as HTMLTextAreaElement).value)
      .toBe("VPN gateway error 403 on client connect");
    expect((document.querySelector("#ticket-status") as HTMLSelectElement).value).toBe("pending");
    expect((document.querySelector("#ticket-priority") as HTMLSelectElement).value).toBe("high");
    expect((document.querySelector("#ticket-assignee") as HTMLSelectElement).value).toBe("alice");
    expect((document.querySelector("#ticket-due-date") as HTMLInputElement).value).toBe("2026-12-01");

    // Status select offers the five Jira states, not a step rail.
    const statuses = [...(document.querySelector("#ticket-status") as HTMLSelectElement).options]
      .map((o) => o.value);
    expect(statuses).toEqual(["open", "pending", "in_progress", "done", "reopened"]);

    expect(text).toContain("Cancel");
    expect(text).toContain("Save changes");
  });

  it("keeps notes, quick tags and the activity history on the Activity tab", async () => {
    await mount(<EditTicketDialog {...props} onOpenChange={vi.fn()} />);

    // Nothing from Activity leaks into the Details tab.
    expect(document.body.textContent).not.toContain("Investigation under way");

    const activityTab = [...document.querySelectorAll('button[role="tab"]')]
      .find((b) => b.textContent?.includes("Activity")) as HTMLButtonElement;
    await act(async () => { activityTab.click(); });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Investigation under way");
    expect(text).toContain("Waiting for requester response");
    expect(document.querySelector('textarea[aria-label="Activity note"]')).toBeTruthy();

    // The existing comment is rendered as history.
    expect(text).toContain("Status moved to Pending");
    expect(text).toContain("ith@admin");
  });

  it("sends the changed status and note through onStatus, and the fields through onSave", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onStatus = vi.fn().mockResolvedValue(true);
    const onOpenChange = vi.fn();

    await mount(
      <EditTicketDialog
        {...props}
        onSave={onSave}
        onStatus={onStatus}
        onOpenChange={onOpenChange}
      />,
    );

    const status = document.querySelector("#ticket-status") as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(status, "in_progress");
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const activityTab = [...document.querySelectorAll('button[role="tab"]')]
      .find((b) => b.textContent?.includes("Activity")) as HTMLButtonElement;
    await act(async () => { activityTab.click(); });

    const note = document.querySelector('textarea[aria-label="Activity note"]') as HTMLTextAreaElement;
    const noteSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      noteSetter.call(note, "On site replacing the gateway");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const save = [...dialog().querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Save changes")) as HTMLButtonElement;
    await act(async () => { save.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(onSave).toHaveBeenCalledTimes(1);
    // The composer defaults to "Internal note", so the note must be flagged agent-only.
    expect(onStatus).toHaveBeenCalledWith("in_progress", "On site replacing the gateway", true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});