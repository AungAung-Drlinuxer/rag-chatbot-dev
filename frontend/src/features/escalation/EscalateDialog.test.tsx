/**
 * Escalate dialog behaviour that the acceptance criteria name directly:
 * nothing is created before "Confirm & Create", the edited body is what gets sent, and a
 * failed submit leaves the draft (and its idempotency key) in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/features/escalation/api", () => ({
  getEscalationFields: vi.fn(),
  createEscalationDraft: vi.fn(),
  submitEscalation: vi.fn(),
}));

import * as api from "@/features/escalation/api";
import { EscalateDialog } from "@/features/escalation/EscalateDialog";

const m = api as unknown as Record<string, any>;
let container: HTMLDivElement | null = null;
let root: Root | null = null;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const DRAFT = {
  draft_id: "d-1",
  session_id: "s-1",
  content_hash: "hash-1",
  source: "llm" as const,
  summary: "VPN drops every 10 minutes",
  description: "*Problem*\nVPN drops\n\n*Still needed*\n- When did it start?",
  missing_info: ["When did it start?"],
  kb_links: [{ title: "VPN runbook", url: "https://kb/vpn" }],
  project: "IT",
  issue_type: "Task",
  priority: "Medium",
  custom_fields: {},
};

const FIELDS = {
  configured: true,
  projects: [{ key: "IT", name: "IT Support" }],
  default_project: "IT",
  issue_types: [{ id: "1", name: "Task" }, { id: "2", name: "Bug" }],
  default_issue_type: "Task",
  priorities: ["Highest", "High", "Medium", "Low"],
  required_fields: [],
};

async function mount() {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<EscalateDialog open onOpenChange={() => {}} sessionId="s-1" onToast={() => {}} />);
  });
  await settle();
  await settle();
  return document.body;
}

function byLabel(body: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  return body.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickConfirm(body: HTMLElement) {
  const btn = Array.from(body.querySelectorAll("button"))
    .find((b) => /Confirm & Create/i.test(b.textContent || "")) as HTMLButtonElement | undefined;
  if (!btn) throw new Error("confirm button not found");
  return btn;
}

beforeEach(() => {
  m.getEscalationFields.mockResolvedValue(FIELDS);
  m.createEscalationDraft.mockResolvedValue(DRAFT);
  m.submitEscalation.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

describe("EscalateDialog", () => {
  it("prefills the form from the draft without creating anything", async () => {
    const body = await mount();
    expect(m.createEscalationDraft).toHaveBeenCalledWith("s-1");
    expect(m.submitEscalation).not.toHaveBeenCalled();
    expect((byLabel(body, "Ticket summary") as HTMLInputElement).value).toBe(DRAFT.summary);
    expect(body.textContent).toContain("Nothing is created until you confirm");
    expect(body.textContent).toContain("When did it start?");
    expect(body.textContent).toContain("VPN runbook");
  });

  it("submits the edited text, not the generated draft", async () => {
    m.submitEscalation.mockResolvedValue({ jira_key: "IT-77", link: "https://jira/browse/IT-77", duplicate: false });
    const body = await mount();

    setValue(byLabel(body, "Ticket summary"), "VPN drops (edited)");
    setValue(byLabel(body, "Ticket description"), "my own description");
    await settle();

    await act(async () => { clickConfirm(body).click(); });
    await settle();

    const payload = m.submitEscalation.mock.calls[0][0];
    expect(payload.summary).toBe("VPN drops (edited)");
    expect(payload.description).toBe("my own description");
    expect(payload.base_hash).toBe("hash-1");
    expect(payload.idempotency_key).toMatch(/[0-9a-f-]{36}/);
    expect(body.textContent).toContain("IT-77");
  });

  it("keeps the draft and the retry key when Jira refuses", async () => {
    m.submitEscalation.mockRejectedValue(new Error("Jira did not create the ticket."));
    const body = await mount();

    setValue(byLabel(body, "Ticket description"), "still mine");
    await settle();
    await act(async () => { clickConfirm(body).click(); });
    await settle();

    expect(body.textContent).toContain("Jira did not create the ticket.");
    expect((byLabel(body, "Ticket description") as HTMLTextAreaElement).value).toBe("still mine");
    expect(clickConfirm(body).disabled).toBe(false);
  });

  it("reuses one idempotency key for retries of the same draft", async () => {
    m.submitEscalation.mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ jira_key: "IT-78", link: "", duplicate: false });
    const body = await mount();

    await act(async () => { clickConfirm(body).click(); });
    await settle();
    await act(async () => { clickConfirm(body).click(); });
    await settle();

    const [first, second] = m.submitEscalation.mock.calls;
    expect(first[0].idempotency_key).toBe(second[0].idempotency_key);
  });
});
