/**
 * Component picker — Jira's own component list, with the free-text field as the fallback.
 *
 * THE POINT: a component name Jira does not recognise is not a validation error the user
 * sees, it is a field that gets dropped after the ticket exists. Offering the project's list
 * is what makes an invalid component impossible to type.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ComponentPicker } from "./ComponentPicker";

const OPTIONS = [
  { id: "1", name: "Active Directory" },
  { id: "2", name: "Kubernetes" },
  { id: "3", name: "MCP" },
];

let container: HTMLDivElement;
let root: Root;

function Harness({ options, initial = "" }: { options: typeof OPTIONS; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <ComponentPicker value={value} onChange={setValue} options={options} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

function paint(options = OPTIONS, initial = "") {
  act(() => {
    root.render(<Harness options={options} initial={initial} />);
  });
}

const value = () => container.querySelector('[data-testid="value"]')?.textContent ?? "";
const trigger = () => container.querySelector("#ticket-components") as HTMLElement;
const options = () => [...container.querySelectorAll('[role="option"]')] as HTMLElement[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ComponentPicker", () => {
  it("falls back to the plain input when the project offers no components", () => {
    paint([]);
    const field = trigger();
    // An input, not the picker button: unconfigured Jira must not block submission.
    expect(field.tagName).toBe("INPUT");
    expect((field as HTMLInputElement).placeholder).toContain("must exist in Jira");
  });

  it("lists the project's components and writes the selection back as names", () => {
    paint();
    act(() => trigger().click());
    expect(options().map((o) => o.textContent)).toEqual([
      "Active Directory",
      "Kubernetes",
      "MCP",
    ]);

    const mcp = options().find((o) => o.textContent?.includes("MCP"))!;
    act(() => mcp.click());
    expect(value()).toBe("MCP");

    // The panel stays open after a pick — more than one component is the normal case.
    const k8s = options().find((o) => o.textContent?.includes("Kubernetes"))!;
    act(() => k8s.click());
    expect(value()).toBe("MCP, Kubernetes");
  });

  it("filters the list by the search box", () => {
    paint();
    act(() => trigger().click());
    const search = container.querySelector('[aria-label="Search components"]') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "kube");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(options().map((o) => o.textContent)).toEqual(["Kubernetes"]);
  });

  it("warns when the stored value is not one of the project's components", () => {
    paint(OPTIONS, "Network & VPN");
    expect(container.textContent).toContain("not in this project");
  });

  it("removes a selected chip without opening the list", () => {
    paint(OPTIONS, "MCP, Kubernetes");
    const remove = container.querySelector('[aria-label="Remove MCP"]') as HTMLElement;
    act(() => remove.click());
    expect(value()).toBe("Kubernetes");
  });
});
