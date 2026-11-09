import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MessageBubble from "./MessageBubble";
import type { Message } from "@/features/chat/model";

const message: Message = {
  id: "answer-1",
  role: "assistant",
  content: "**bold** answer",
  timestamp: "10:00 AM",
  sources: [{
    page_id: "kb-1",
    title: "Restart runbook",
    space: "Infrastructure",
    relevance: 95,
    excerpt: "Restart procedure",
  }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

function render(preferences: {
  showSources?: boolean;
  showTokenUsage?: boolean;
  markdownRendering?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <MessageBubble
      message={message}
      onHelpful={() => {}}
      onNotHelpful={() => {}}
      onOpenTicketForm={() => {}}
      {...preferences}
    />,
  );
}

describe("MessageBubble user preferences", () => {
  it("renders Markdown, citations, and token usage by default", () => {
    const html = render();
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("Restart runbook");
    expect(html).toContain("10 in");
    expect(html).toContain("20 out");
  });

  it("honors disabled rendering preferences", () => {
    const html = render({ showSources: false, showTokenUsage: false, markdownRendering: false });
    expect(html).toContain("**bold** answer");
    expect(html).not.toContain("<strong>bold</strong>");
    expect(html).not.toContain("Restart runbook");
    expect(html).not.toContain("10 in");
    expect(html).not.toContain("20 out");
  });
});

describe("MessageBubble — guardrail refusal", () => {
  const refusal: Message = {
    id: "g-1",
    role: "assistant",
    content: "I can't accept that message because it appears to contain personal data.",
    timestamp: "10:01 AM",
    guardrailType: "pii",
    decision: "guardrail",
    sources: [],
  };

  const html = renderToStaticMarkup(
    <MessageBubble
      message={refusal}
      onHelpful={() => {}}
      onNotHelpful={() => {}}
      onOpenTicketForm={() => {}}
    />,
  );

  it("explains which rule fired, in words", () => {
    expect(html).toContain("Blocked by content policy");
    expect(html).toContain("personal or secret data");
  });

  it("keeps the refusal visible as the answer", () => {
    expect(html).toContain("I can&#x27;t accept that message");
  });

  it("does not claim the answer is grounded in the knowledge base", () => {
    expect(html).not.toContain("Grounded in your knowledge base");
    expect(html).toContain("Policy response — no sources consulted");
  });

  it("offers thumbs, not a tick and a warning triangle", () => {
    expect(html).toContain("lucide-thumbs-up");
    expect(html).toContain("lucide-thumbs-down");
    expect(html).not.toContain("lucide-check-circle");
  });
});
