/**
 * The shared footer: one sentence, real page numbers.
 *
 * The bug this guards: Conversations rendered "Showing 51 to 60 of 98" above a second line
 * that said "Showing 98 of 98", and its pager offered 1–5 plus a dead "… 10" that was a
 * <span>, so pages 6–9 were reachable only by clicking Next eight times.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PaginationBar, pageWindow } from "./pagination";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(ui: React.ReactNode) {
  act(() => root.render(ui));
  return container;
}

describe("PaginationBar", () => {
  it("states one range with an en dash and the noun", () => {
    const el = render(
      <PaginationBar from={51} to={60} total={98} page={6} pageCount={10} onPage={() => {}} noun="conversations" />,
    );
    expect(el.textContent).toContain("Showing 51–60 of 98 conversations");
    // The old second line contradicted the first; it must not exist at all.
    expect(el.textContent?.match(/conversations/g)?.length).toBe(1);
  });

  it("offers the last page as a real button, not an ellipsis label", () => {
    const calls: number[] = [];
    const el = render(
      <PaginationBar from={51} to={60} total={98} page={6} pageCount={10} onPage={(n) => calls.push(n)} noun="events" />,
    );
    const last = el.querySelector('button[aria-label="Page 10"]') as HTMLButtonElement;
    expect(last).toBeTruthy();
    act(() => last.click());
    expect(calls).toEqual([10]);
    expect(el.querySelector('[aria-current="page"]')?.textContent).toBe("6");
  });

  it("hides the pager when everything fits on one page", () => {
    const el = render(
      <PaginationBar from={1} to={3} total={3} page={1} pageCount={1} onPage={() => {}} noun="tickets" />,
    );
    expect(el.textContent).toContain("Showing 1–3 of 3 tickets");
    expect(el.querySelector("nav")).toBeNull();
  });

  it("keeps the window around the current page", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(6, 10)).toEqual([1, "gap", 5, 6, 7, "gap", 10]);
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10]);
  });
});
