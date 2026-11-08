/** Chat streaming contract — the ONLY place SSE events are interpreted.
 *
 * Backend /api/chat/stream emits: meta → stage* → token* → (approval_request)? → done
 * This module maps raw events to typed callbacks; the page wires them to state.
 * Keeping the parsing here means the HITL (LangGraph interrupt) contract, the
 * confidence/sources meta shape, and token accumulation live in ONE file.
 */
import { streamChat } from "@/features/chat/api";

export type StreamHandlers = {
  onMeta: (meta: any) => void;
  onToken: (token: string) => void;
  onStage: (detail: string, stageKey?: string) => void;
  onApprovalRequest: (data: any) => void;
  onDone: (d: any) => void;
  /** v1.1.4 — guardrail event: blocked (injection/overflow) or flagged (toxic) */
  onCaution?: (data: any) => void;
};

export async function runChatStream(
  question: string,
  sessionId: string,
  history: { role: string; content: string }[],
  h: StreamHandlers,
  llmProvider?: "auto" | "cloud" | "local",
  signal?: AbortSignal
): Promise<string> {
  let streamed = "";
  await streamChat(question, sessionId, history, (e) => {
    if (e.event === "meta") {
      h.onMeta(e.data ?? {});
    } else if (e.event === "token") {
      const token =
        typeof e.data === "string"
          ? e.data
          : (e.data?.token ?? e.data?.text ?? "");
      streamed += token;
      h.onToken(token);
    } else if (e.event === "stage") {
      // v1.6.16 — pass the canonical stage key + human detail so the
      // pipeline tracker can time each stage exactly.
      h.onStage(e.data?.detail || e.data?.stage || "", e.data?.stage || "");
    } else if (e.event === "approval_request") {
      h.onApprovalRequest(e.data);
    } else if (e.event === "caution") {
      // v1.1.4 guardrail: when blocked=true the backend sends NO tokens and
      // closes with done{guardrail:...} — surface the policy message to the user
      // instead of the generic "No answer received" fallback.
      if (e.data?.blocked) {
        h.onToken(e.data.message || "Your message was blocked by content security policy.");
        streamed += e.data.message || "";
      } else {
        h.onStage(e.data?.message || e.data?.detail || "Low confidence — showing caution notice");
      }
      h.onCaution?.(e.data ?? {});
    } else if (e.event === "done") {
      h.onDone(e.data ?? {});
    }
  }, llmProvider, signal);
  return streamed;
}
