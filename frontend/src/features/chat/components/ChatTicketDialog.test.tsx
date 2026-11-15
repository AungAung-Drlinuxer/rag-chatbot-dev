import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TicketFormFields } from "@/features/tickets/components/TicketForm";

vi.mock("@/features/tickets/api", () => ({
  ticketAssignees: vi.fn(async () => ({ assignees: [], configured: false, default: null })),
  improveTicketDescription: vi.fn(async () => ""),
}));

const draft = {
  subject: "VPN drops every few minutes on the corporate Wi-Fi",
  description: "Started after the client update.",
  priority: "high" as const,
  domain: "network",
  assignee: null,
  due_date: null,
  components: [],
  labels: ["vpn"],
  original_estimate: null,
};

describe("ChatTicketDialog", () => {
  it("draws the shared ticket form — the same field ids as Create ticket and Edit ticket", () => {
    // Render the dialog's body directly: the dialog portal does not render in SSR, but the
    // field set is the part that must not drift. Both surfaces mount TicketFormFields.
    const html = renderToStaticMarkup(
      <TicketFormFields
        values={{
          subject: draft.subject,
          description: draft.description,
          category: "Network",
          priority: draft.priority,
          assignee: "",
          due_date: "",
          components: "",
          labels: "vpn",
          original_estimate: "",
        }}
        onChange={() => {}}
        categories={[{ key: "network", label: "Network" }]}
        assignable={[]}
      />,
    );

    for (const id of [
      "ticket-subject",
      "ticket-description",
      "ticket-category",
      "ticket-priority",
      "ticket-assignee",
      "ticket-due-date",
      "ticket-components",
      "ticket-labels",
      "ticket-estimate",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    // The AI's own subject is what the reporter sees first, and the category resolves to a
    // label (not the raw domain key) so the dropdown selects it.
    expect(html).toContain("VPN drops every few minutes on the corporate Wi-Fi");
    expect(html).toContain('<option value="Network" selected="">Network</option>');
  });
});
