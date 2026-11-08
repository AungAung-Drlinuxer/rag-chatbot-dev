/**
 * SetupChecklist — the readiness strip on Settings → Integrations.
 *
 * These assertions pin the contract the backend owns: a `todo` step names the action, a
 * `blocked` step is visibly different from a user-fixable one, and a finished install
 * collapses to a single line instead of an empty checklist frame.
 *
 * Harness: no @testing-library by choice (matching the other page tests) — react-dom/client
 * inside act() with direct DOM queries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import SetupChecklist from "./SetupChecklist";
import { getSetupReadiness } from "@/features/settings/api";

vi.mock("@/features/settings/api", () => ({ getSetupReadiness: vi.fn() }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const base = {
  ready: false,
  database: { tables: 29, vector_version: "0.8.0", checkpoints: true, ok: true },
  knowledge: {
    confluence_configured: false, spaces: [], articles: 0, domains: 0, last_sync: null,
  },
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => { root.render(<SetupChecklist />); });
}

describe("SetupChecklist", () => {
  beforeEach(() => vi.mocked(getSetupReadiness).mockReset());

  it("lists the outstanding steps with their hint", async () => {
    vi.mocked(getSetupReadiness).mockResolvedValue({
      ...base,
      steps: [
        { key: "database", label: "Database", status: "done", detail: "29 tables · pgvector 0.8.0" },
        { key: "knowledge", label: "Knowledge base", status: "todo",
          detail: "No document source connected", hint: "Add Confluence under Settings → Integrations" },
      ],
    } as any);

    await render();

    expect(host.textContent).toContain("Finish setting up");
    expect(host.textContent).toContain("1 left");
    expect(host.textContent).toContain("Add Confluence under Settings → Integrations");
  });

  it("marks a server-side blocker as such, not as a to-do", async () => {
    vi.mocked(getSetupReadiness).mockResolvedValue({
      ...base,
      steps: [
        { key: "administrator", label: "Administrator", status: "blocked",
          detail: "none yet", hint: "Create one with: python -m app.bootstrap --admin <username>" },
      ],
    } as any);

    await render();

    expect(host.textContent).toContain("Needs server access");
  });

  it("collapses to one line once the install is ready", async () => {
    vi.mocked(getSetupReadiness).mockResolvedValue({
      ...base,
      ready: true,
      knowledge: { ...base.knowledge, confluence_configured: true, articles: 94, domains: 6 },
      steps: [{ key: "database", label: "Database", status: "done", detail: "29 tables" }],
    } as any);

    await render();

    expect(host.textContent).toContain("Installation ready");
    expect(host.textContent).not.toContain("Finish setting up");
    expect(host.textContent).toContain("94 indexed articles");
  });
});
