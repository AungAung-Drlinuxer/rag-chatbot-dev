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

  it("renders the interactive jira workflow modal with 4 steps and quick tags", async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn().mockResolvedValue(true);
    const onStatus = vi.fn().mockResolvedValue(true);

    await mount(
      <EditTicketDialog
        open={true}
        onOpenChange={onOpenChange}
        ticket={SAMPLE_TICKET}
        comments={[{ id: 1, author: "ith@admin", body: "Status moved to Pending", kind: "status", created_at: "2026-11-11T00:42:00Z" }]}
        attachments={[]}
        assignable={[{ username: "alice", email: "alice@example.com", role: "admin" }]}
        jiraReady={true}
        onSave={onSave}
        onStatus={onStatus}
        onAddAttachment={vi.fn()}
        onDeleteAttachment={vi.fn()}
      />
    );

    expect(document.body.textContent).toContain("INTERACTIVE JIRA WORKFLOW");
    expect(document.body.textContent).toContain("#IT-1");
    expect(document.body.textContent).toContain("Jira Sync Active");

    // Stepper steps
    expect(document.body.textContent).toContain("Open");
    expect(document.body.textContent).toContain("Pending");
    expect(document.body.textContent).toContain("In progress");
    expect(document.body.textContent).toContain("Done");

    // Quick tags
    expect(document.body.textContent).toContain("Investigation under way");
    expect(document.body.textContent).toContain("Waiting for requester response");

    // Metadata
    expect(document.body.textContent).toContain("ith@admin");
    expect(document.body.textContent).toContain("Network");

    // Action buttons
    expect(document.body.textContent).toContain("Cancel");
    expect(document.body.textContent).toContain("Save & Sync to Jira");
  });
});
