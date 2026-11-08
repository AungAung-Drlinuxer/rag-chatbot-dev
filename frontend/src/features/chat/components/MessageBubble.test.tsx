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
