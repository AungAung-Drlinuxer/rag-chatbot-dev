/**
 * The floating assistant's conversation, kept across page changes and hard reloads.
 *
 * The widget lives inside the page shell, so navigating to another page — and certainly a
 * browser refresh — threw away its React state and the user came back to an empty "Ask an IT
 * question" box with a brand-new session id. A snapshot in sessionStorage survives both: it
 * is per-tab (a shared machine does not inherit someone else's thread), and it dies with the
 * tab, which is the right lifetime for an ephemeral helper.
 *
 * `X` still means "start over": it deletes the snapshot so the next open is genuinely new.
 */
import type { Message, Source } from "@/features/chat/model";

const KEY = "ith:assistant-snapshot";
const MAX_MESSAGES = 40;

export type AssistantMessage = Message & {
  sources?: Source[];
  confidence?: number;
  failed?: boolean;
  retryQuestion?: string;
};

export type AssistantSnapshot = { sessionId: string; messages: AssistantMessage[] };

export function loadAssistantSnapshot(): AssistantSnapshot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssistantSnapshot;
    if (!parsed || typeof parsed.sessionId !== "string" || !Array.isArray(parsed.messages)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAssistantSnapshot(snapshot: AssistantSnapshot): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        sessionId: snapshot.sessionId,
        messages: snapshot.messages.slice(-MAX_MESSAGES),
      }),
    );
  } catch {
    /* private mode / quota — the live thread still works, it just will not survive a reload */
  }
}

export function clearAssistantSnapshot(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
