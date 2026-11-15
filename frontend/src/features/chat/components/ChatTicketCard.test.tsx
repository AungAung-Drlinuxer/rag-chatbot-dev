import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { ChatTicketCard } from "./ChatTicketCard";

const draft = {
  subject: "VPN fails with expired certificate on macOS",
  description: "GlobalProtect returns 403.\nCertificate re-push needed.",
  priority: "high" as const,
  domain: "network",
  assignee: "netops",
  due_date: "2026-11-20",
};

function mount(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, root };
}

describe("ChatTicketCard", () => {
  it("shows the extracted fields and both decisions", () => {
    const { host } = mount(
      <ChatTicketCard draft={draft} domainLabel="Network" onEdit={() => {}} onCreate={() => {}} />,
    );

    expect(host.textContent).toContain(draft.subject);
    expect(host.textContent).toContain("AI extracted");
    expect(host.textContent).toContain("Network");
    const labels = [...host.querySelectorAll("button")].map((b) => b.textContent || "");
    expect(labels.some((t) => /create ticket/i.test(t))).toBe(true);
    expect(labels.some((t) => /edit details/i.test(t))).toBe(true);
  });

  it("becomes a receipt once the issue exists, and refuses to re-create", () => {
    const onCreate = vi.fn();
    const { host } = mount(
      <ChatTicketCard
        draft={draft}
        created={{ key: "ITHD-501", link: "https://example.atlassian.net/browse/ITHD-501" }}
        onEdit={() => {}}
        onCreate={onCreate}
      />,
    );

    expect(host.textContent).toContain("Jira ticket created");
    expect(host.textContent).toContain("ITHD-501");
    const buttons = [...host.querySelectorAll("button")].map((b) => b.textContent || "");
    expect(buttons.some((t) => /create ticket/i.test(t))).toBe(false);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
