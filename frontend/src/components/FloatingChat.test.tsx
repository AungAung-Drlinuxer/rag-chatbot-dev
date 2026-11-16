/**
 * The floating assistant must survive navigation.
 *
 * THE BUG THIS GUARDS: the router changes routes with `history.replaceState`, which fires no
 * `hashchange`. The popup kept the "am I on the chat page?" answer in state seeded at mount,
 * so leaving the chat page left it `true` and the bubble vanished — it only came back after a
 * real hashchange (a reload or a back/forward), which is why it "sometimes" appeared.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/api", () => ({
  getMySettings: vi.fn().mockResolvedValue({}),
}));

import { FloatingChatPopup, FloatingChatProvider } from "./FloatingChat";

let container: HTMLDivElement;
let root: Root;

function navigate(hash: string) {
  window.history.replaceState(null, "", hash);
}

function paint() {
  act(() => {
    root.render(
      <FloatingChatProvider>
        <FloatingChatPopup />
      </FloatingChatProvider>,
    );
  });
}

const bubble = () => container.querySelector('[aria-label="Open IT assistant"]');

beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

describe("FloatingChatPopup route awareness", () => {
  it("is hidden on the chat page, where the composer is already the input", () => {
    navigate("#/");
    paint();
    expect(bubble()).toBeNull();
  });

  it("comes back after a replaceState navigation away from chat", () => {
    navigate("#/");
    paint();
    expect(bubble()).toBeNull();

    navigate("#/users");
    paint();
    expect(bubble()).not.toBeNull();
  });

  it("hides again when the router returns to chat", () => {
    navigate("#/tickets");
    paint();
    expect(bubble()).not.toBeNull();

    navigate("#/");
    paint();
    expect(bubble()).toBeNull();
  });
});
