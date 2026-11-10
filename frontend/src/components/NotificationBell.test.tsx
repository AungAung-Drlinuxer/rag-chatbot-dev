/**
 * The bell is the only place the shell says "someone is waiting on you".
 *
 * Regressions pinned here: the badge counts *unread* notices (a queue that existed before the
 * tab opened is not new), opening the list clears the badge, and a genuinely new notice rings
 * the chime once — never on the silent first poll.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import type { ComponentProps } from "react";
import { NotificationBell, type Notice } from "@/components/NotificationBell";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function mount(notices: Notice[], props: Partial<ComponentProps<typeof NotificationBell>> = {}) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<NotificationBell notices={notices} {...props} />); });
  await settle();
  // The panel is portaled to <body> so it can be positioned against the viewport.
  return document.body;
}

const notice = (id: string): Notice => ({ id, kind: "approval", label: `Approve ${id}`, sub: "HITL approval" });

// jsdom in this setup exposes no storage; the component treats storage as optional, so a
// Map-backed stub is enough to exercise the read/unread behaviour.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.useRealTimers();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null; container = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("NotificationBell", () => {
  it("counts unread notices in the badge", async () => {
    const el = await mount([notice("ap-1"), notice("ap-2")]);
    const badge = el.querySelector('[aria-label="Notifications, 2 unread"]');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain("2");
  });

  it("clears the badge when the list is opened", async () => {
    const el = await mount([notice("ap-1")]);
    const bell = el.querySelector('[aria-label^="Notifications"]') as HTMLButtonElement;
    await act(async () => { bell.click(); });
    await settle();
    expect(el.querySelector('[aria-label^="Notifications,"]')).toBeNull();
    expect(el.textContent).toContain("Approve ap-1");
  });

  it("rings once for a notice that arrives after the first poll", async () => {
    // jsdom has no Web Audio; count contexts instead of listening. `playChime` swallows any
    // failure, so the assertion is "we tried to make a sound", not "a sound was audible".
    let contexts = 0;
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      createOscillator() { return { type: "", frequency: { value: 0 }, connect: (n: unknown) => n, start: () => {}, stop: () => {} }; }
      createGain() {
        return { gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n };
      }
      close() { return Promise.resolve(); }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = function () {
      contexts += 1;
      return new FakeAudioContext();
    };
    const el = await mount([notice("ap-1")]);
    // First poll is a silent baseline: nothing rings for work that was already waiting.
    expect(contexts).toBe(0);

    await act(async () => { root!.render(<NotificationBell notices={[notice("ap-1"), notice("ap-2")]} />); });
    await settle();
    expect(contexts).toBe(1);
    expect(el.textContent).toBeDefined();
  });

  it("does not claim 'caught up' when the feed failed", async () => {
    if (root) await act(async () => { root!.unmount(); });
    container?.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    let retried = 0;
    await act(async () => {
      root!.render(<NotificationBell notices={[]} error="HTTP 429" onRetry={() => { retried += 1; }} />);
    });
    await settle();

    const bell = document.body.querySelector('[aria-label="Notifications"]') as HTMLButtonElement;
    await act(async () => { bell.click(); });
    await settle();

    expect(document.body.textContent).not.toContain("You're all caught up");
    expect(document.body.textContent).toContain("Couldn't load notifications");
    expect(document.body.textContent).toContain("HTTP 429");

    const retry = Array.from(document.body.querySelectorAll("button")).find((b) => /Retry/i.test(b.textContent || ""));
    await act(async () => { retry!.click(); });
    expect(retried).toBe(1);
  });

  it("shows the caught-up state when the queue is empty", async () => {
    const el = await mount([]);
    const bell = el.querySelector('[aria-label="Notifications"]') as HTMLButtonElement;
    await act(async () => { bell.click(); });
    await settle();
    expect(el.textContent).toContain("You're all caught up");
  });

  it("offers Clear only when there is something to clear, and calls the server-backed handler", async () => {
    let cleared = 0;
    const el = await mount([notice("ap-1")], { onClear: () => { cleared += 1; } });
    const trigger = el.querySelector('[aria-label^="Notifications"]') as HTMLElement;
    await act(async () => { trigger.click(); });
    const clear = document.querySelector('[aria-label="Clear notifications"]') as HTMLButtonElement;
    expect(clear).toBeTruthy();
    await act(async () => { clear.click(); });
    expect(cleared).toBe(1);

    // Nothing in the feed → nothing to clear.
    await mount([], { onClear: () => { cleared += 1; } });
    await act(async () => {
      (document.querySelector('[aria-label^="Notifications"]') as HTMLElement).click();
    });
    const empty = document.querySelector('[aria-label="Clear notifications"]') as HTMLButtonElement;
    expect(empty.disabled).toBe(true);
  });
});
