/** Unit tests for the SSE contract (features/chat/hooks/useChatStream).
 *  Guards the HITL interrupt mapping + token accumulation + meta merge shape. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/features/chat/api", () => ({
  streamChat: vi.fn(async (_q: string, _s: string, _h: unknown, onEvent: (e: any) => void, _prov?: string) => {
    // scripted backend event sequence (drives the mock below)
    (globalThis as any).__emit(onEvent);
  }),
}));

import { runChatStream } from "@/features/chat/hooks/useChatStream";
import { streamChat } from "@/features/chat/api";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const emit = (onEvent: (e: any) => void, ...events: any[]) =>
  events.forEach((e) => onEvent(e));

describe("runChatStream", () => {
  it("maps meta → token* → done and returns accumulated text", async () => {
    (globalThis as any).__emit = (cb: any) =>
      emit(
        cb,
        { event: "meta", data: { domain: "network", confidence: 0.8, decision: "answer" } },
        { event: "stage", data: { detail: "reranking" } },
        { event: "token", data: { token: "VPN " } },
        { event: "token", data: "restart " },
        { event: "token", data: { text: "your adapter." } },
        { event: "done", data: { message_id: "m-1", usage: { total_tokens: 42 } } }
      );
    const h = {
      onMeta: vi.fn(), onToken: vi.fn(), onStage: vi.fn(),
      onApprovalRequest: vi.fn(), onDone: vi.fn(),
    };
    const out = await runChatStream("q", "s", [], h);
    expect(out).toBe("VPN restart your adapter.");
    expect(h.onMeta).toHaveBeenCalledWith(expect.objectContaining({ domain: "network" }));
    expect(h.onStage).toHaveBeenCalledWith("reranking", "");
    expect(h.onToken).toHaveBeenCalledTimes(3);
    expect(h.onDone).toHaveBeenCalledWith(expect.objectContaining({ message_id: "m-1" }));
    expect(h.onApprovalRequest).not.toHaveBeenCalled();
  });

  it("surfaces the HITL interrupt (approval_request) between tokens and done", async () => {
    (globalThis as any).__emit = (cb: any) =>
      emit(
        cb,
        { event: "meta", data: {} },
        { event: "approval_request", data: { id: 7, question: "Create ticket?" } },
        { event: "done", data: {} }
      );
    const h = {
      onMeta: vi.fn(), onToken: vi.fn(), onStage: vi.fn(),
      onApprovalRequest: vi.fn(), onDone: vi.fn(),
    };
    await runChatStream("q", "s", [], h);
    expect(h.onApprovalRequest).toHaveBeenCalledWith({ id: 7, question: "Create ticket?" });
  });

  it("tolerates unknown events and null data without throwing", async () => {
    (globalThis as any).__emit = (cb: any) =>
      emit(
        cb,
        { event: "heartbeat", data: null },
        { event: "meta", data: null },
        { event: "done", data: null },
        { event: "token", data: null }
      );
    const h = {
      onMeta: vi.fn(), onToken: vi.fn(), onStage: vi.fn(),
      onApprovalRequest: vi.fn(), onDone: vi.fn(),
    };
    const out = await runChatStream("q", "s", [], h);
    expect(out).toBe("");
    expect(h.onMeta).toHaveBeenCalledWith({});   // null → {} contract
    expect(h.onDone).toHaveBeenCalledWith({});
  });

  it("passes question/session/history through to streamChat", async () => {
    (globalThis as any).__emit = () => {};
    await runChatStream("why", "sess-9", [{ role: "user", content: "hi" }], {
      onMeta: vi.fn(), onToken: vi.fn(), onStage: vi.fn(),
      onApprovalRequest: vi.fn(), onDone: vi.fn(),
    });
    expect(streamChat).toHaveBeenCalledWith(
      // 5th = llmProvider, 6th = AbortSignal. Both are undefined when the caller omits them.
      "why", "sess-9", [{ role: "user", content: "hi" }], expect.any(Function),
      undefined, undefined
    );
  });

});
