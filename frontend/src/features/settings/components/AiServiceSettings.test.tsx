/**
 * The AI service section must survive typing.
 *
 * Regression: `Section` and `ValueInput` were declared inside the page component, so every
 * keystroke produced a new component identity, React unmounted the subtree, and the field lost
 * focus after one character — "type a letter, it disappears". Nothing about the saved value was
 * wrong; the input was being replaced underneath the user.
 *
 * The assertion that catches it is node identity plus focus: after the first character the very
 * same <input> element must still be in the document and still focused.
 */
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const api = vi.hoisted(() => ({
  getIntegrationSettings: vi.fn(async () => ({ settings: { provider: "clinepass", model: "openai/gpt-5" }, fields_set: ["api_key", "base_url", "model"] })),
  putIntegrationSettings: vi.fn(async () => ({ ok: true })),
  deleteIntegrationSettings: vi.fn(async () => ({ ok: true })),
  getLlmModels: vi.fn(async () => ({ models: [{ id: "openai/gpt-5" }, { id: "openai/gpt-5-mini" }], source: "test" })),
  getRuntime: vi.fn(async () => ({ overrides: { retrieval_top_k: 5, confidence_gate_threshold: 0.75 } })),
  putRuntime: vi.fn(async () => ({ ok: true })),
  testIntegration: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/features/settings/api", () => api);

import { AiServiceSettings } from "@/features/settings/components/AiServiceSettings";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AiServiceSettings — typing", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<AiServiceSettings isAdmin />); });
    await settle();
    return container;
  }

  it("keeps the model id input mounted and focused across keystrokes", async () => {
    const el = await mount();
    const first = el.querySelector('input[aria-label="Model id"]') as HTMLInputElement;
    expect(first).toBeTruthy();
    first.focus();
    expect(document.activeElement).toBe(first);

    await act(async () => { typeInto(first, "a"); });
    await settle();

    const after = el.querySelector('input[aria-label="Model id"]') as HTMLInputElement;
    expect(after).toBe(first);            // same DOM node: nothing remounted
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("a");

    await act(async () => { typeInto(after, "ab"); });
    await settle();

    const third = el.querySelector('input[aria-label="Model id"]') as HTMLInputElement;
    expect(third).toBe(first);
    expect(third.value).toBe("ab");
    expect(document.activeElement).toBe(third);

    await act(async () => { root!.unmount(); });
    root = null;
    container?.remove();
    container = null;
  });
});
