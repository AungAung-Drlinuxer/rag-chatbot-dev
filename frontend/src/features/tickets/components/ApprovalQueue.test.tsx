/**
 * Human in the loop, in the UI.
 *
 * The graph already paused and wrote an `approvals` row; the bell already pointed at Tickets.
 * What was missing was the decision itself, so an escalation could wait forever or be bypassed
 * by creating the ticket from the answer. These tests pin that a pending row is visible, that
 * Approve reports the ticket the graph created, and that nothing renders when the queue is
 * empty (an empty "Awaiting your decision" banner is noise).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/chat/api", () => ({
  listApprovals: vi.fn(),
  decideApproval: vi.fn(),
}));

import * as chatApi from "@/features/chat/api";
import { ApprovalQueue } from "@/features/tickets/components/ApprovalQueue";

const m = chatApi as unknown as Record<string, any>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const toasts: any[] = [];

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ApprovalQueue onToast={(msg, tone) => toasts.push([msg, tone])} />);
  });
  await settle();
  await settle();
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  toasts.length = 0;
  m.listApprovals.mockResolvedValue({
    approvals: [
      { id: "a1", username: "alice", question: "VPN keeps dropping on the 3rd floor", status: "pending", created_at: "2026-11-08T09:00:00Z" },
      { id: "a2", username: "bob", question: "Old resolved request", status: "approved", created_at: "2026-11-07T09:00:00Z" },
    ],
  });
  m.decideApproval.mockResolvedValue({ ok: true, approval_id: "a1", status: "approved", ticket_id: "IT-321" });
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("ApprovalQueue", () => {
  it("shows only the pending escalation, with the requester", async () => {
    const text = (await mount()).textContent!;
    expect(text).toContain("Awaiting your decision");
    expect(text).toContain("1 pending");
    expect(text).toContain("VPN keeps dropping on the 3rd floor");
    expect(text).toContain("alice");
    // A decided row must not be offered again.
    expect(text).not.toContain("Old resolved request");
  });

  it("approving resumes the graph and reports the ticket it created", async () => {
    const el = await mount();
    const approve = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Approve")) as HTMLButtonElement;
    await act(async () => { approve.click(); });
    await settle();

    expect(m.decideApproval).toHaveBeenCalledWith("a1", "approved");
    expect(toasts[0][0]).toContain("IT-321");
  });

  it("rejecting says no ticket was created", async () => {
    m.decideApproval.mockResolvedValue({ ok: true, approval_id: "a1", status: "rejected", ticket_id: null, message: "rejected" });
    const el = await mount();
    const reject = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Reject")) as HTMLButtonElement;
    await act(async () => { reject.click(); });
    await settle();

    expect(m.decideApproval).toHaveBeenCalledWith("a1", "rejected");
    expect(toasts[0][0]).toContain("no ticket was created");
  });

  it("renders nothing when there is nothing to decide", async () => {
    m.listApprovals.mockResolvedValue({ approvals: [] });
    const text = (await mount()).textContent!;
    expect(text).not.toContain("Awaiting your decision");
  });
});
