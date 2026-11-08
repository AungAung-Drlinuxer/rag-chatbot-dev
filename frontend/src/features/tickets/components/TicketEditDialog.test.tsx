/**
 * The edit sheet: one form, one save.
 *
 * These pin the contract the page relies on — the dialog stages everything (details,
 * attachments to add/remove, workflow step, note) and hands it over in a single payload, so
 * there is exactly one moment where Jira can be half-written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { TicketEditDialog, type TicketEditPayload } from "@/features/tickets/components/TicketEditDialog";
import type { Ticket } from "@/features/tickets/model";

const ticket = {
  id: "ITHD-37",
  subject: "printer on floor 4 is jammed",
  description: "Paper jam again.",
  status: "pending",
  priority: "medium",
  category: "network",
  requester: "ith@dmin",
  assignee: null,
  due_date: "2026-11-13T00:00:00Z",
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
} as unknown as Ticket;

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

function byLabel(label: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const el = document.body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no control labelled ${label}`);
  return el;
}

function button(name: RegExp) {
  const el = [...document.body.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
  if (!el) throw new Error(`no button ${name}`);
  return el;
}

async function mount(onSave = vi.fn().mockResolvedValue(true), onClose = vi.fn()) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <TicketEditDialog
        ticket={ticket}
        assignable={[{ username: "AungAung", email: null, role: "admin", group: "Network Team" }]}
        attachments={[{ id: 4, filename: "old.png", size: 2048, created_by: "x" }]}
        jiraReady
        busy={false}
        onClose={onClose}
        onSave={onSave}
      />,
    );
  });
  await settle();
  return { onSave, onClose };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("TicketEditDialog", () => {
  it("prefills the ticket and saves everything the operator changed", async () => {
    const { onSave } = await mount();

    expect((byLabel("Subject") as HTMLInputElement).value).toBe(ticket.subject);
    // The category team is shown behind each assignee, not just the username.
    expect(document.body.textContent).toContain("AungAung · Network Team");

    setValue(byLabel("Subject"), "printer on floor 4 — jam cleared");
    setValue(byLabel("Description"), "Pickup roller replaced.");
    setValue(byLabel("Priority"), "high");
    setValue(byLabel("Move to status"), "in_progress");
    setValue(byLabel("Note for Jira"), "Replaced the pickup roller.");

    // Remove the existing attachment, stage a new one.
    await act(async () => { (byLabel("Remove old.png") as HTMLElement).click(); });
    const file = new File(["x"], "photo.png", { type: "image/png" });
    const picker = byLabel("Add attachments") as HTMLInputElement;
    Object.defineProperty(picker, "files", { value: [file], configurable: true });
    await act(async () => { picker.dispatchEvent(new Event("change", { bubbles: true })); });

    await act(async () => { button(/Save ticket/i).click(); });
    await settle();

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0] as TicketEditPayload;
    expect(payload.subject).toBe("printer on floor 4 — jam cleared");
    expect(payload.priority).toBe("high");
    expect(payload.status).toBe("in_progress");
    expect(payload.comment).toBe("Replaced the pickup roller.");
    expect(payload.removeAttachments).toEqual([4]);
    expect(payload.addFiles.map((f) => f.name)).toEqual(["photo.png"]);
  });

  it("keeps the workflow alone when no step is picked", async () => {
    const { onSave } = await mount();

    setValue(byLabel("Description"), "Jam cleared, no parts needed.");
    await act(async () => { button(/Save ticket/i).click(); });
    await settle();

    const payload = onSave.mock.calls[0][0] as TicketEditPayload;
    expect(payload.status).toBeNull();
    expect(payload.comment).toBe("");
    expect(payload.description).toBe("Jam cleared, no parts needed.");
  });

  it("will not save an empty subject", async () => {
    const { onSave } = await mount();

    setValue(byLabel("Subject"), "   ");
    setValue(byLabel("Description"), "x");
    await act(async () => { button(/Save ticket/i).click(); });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("A ticket needs a subject");
  });

  it("reports a refused save without closing", async () => {
    const { onClose } = await mount(vi.fn().mockResolvedValue(false));

    setValue(byLabel("Description"), "changed");
    await act(async () => { button(/Save ticket/i).click(); });
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Save failed");
  });
});
