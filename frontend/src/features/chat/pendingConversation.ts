/**
 * One-shot handoff for "open this conversation, and switch to the chat page".
 *
 * The sidebar can be clicked from any page. It navigates to chat and fires
 * `ith:open-conversation` — but when chat is not mounted yet, the event fires before the
 * listener exists, so the first click was silently dropped and the row only opened on the
 * second click. A module-level value survives the navigation: chat consumes it on mount.
 * The value is single-use, so it can never reopen an old conversation later.
 */

let pending: string | null = null;

export function setPendingConversation(id: string): void {
  pending = id;
}

/** Read and clear. Returns null when there is nothing waiting. */
export function takePendingConversation(): string | null {
  const id = pending;
  pending = null;
  return id;
}
