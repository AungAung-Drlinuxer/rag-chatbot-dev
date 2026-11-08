/**
 * Dragging and resizing on the board.
 *
 * The maths lives in grid.ts and is tested there; this pins the wiring: a header drag reports a
 * new position, a corner drag reports a new size, and a click that never moved reports nothing
 * (so opening edit mode and clicking around cannot silently rewrite a saved layout).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { GridCanvas } from "@/features/dashboard/panels/GridCanvas";
import type { PanelSpec } from "@/features/dashboard/panels/types";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const panels: PanelSpec[] = [
  { id: "a", type: "note", title: "A", span: 6, x: 0, y: 0, h: 3, options: {} },
  { id: "b", type: "note", title: "B", span: 6, x: 6, y: 0, h: 3, options: {} },
];

async function mount(onChange = vi.fn(), editing = true) {
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <GridCanvas panels={panels} editing={editing} onChange={onChange}>
        {(panel, _index, handles) => (
          <div>
            <div data-drag-handle onPointerDown={handles.onDragStart}>
              {panel.title}
            </div>
            <span
              role="separator"
              aria-label={`Resize ${panel.title}`}
              onPointerDown={handles.onResizeStart}
            />
            <div data-body={panel.id} />
          </div>
        )}
      </GridCanvas>,
    );
  });
  await settle();
  return onChange;
}

function pointer(type: string, x: number, y: number) {
  const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  return e;
}

beforeEach(() => {
  // jsdom has no layout: give the board a real width so a column is 100px.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1200, height: 1000, top: 0, left: 0, right: 1200, bottom: 1000, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => { root!.unmount(); });
  container?.remove();
  root = null;
  container = null;
});

describe("GridCanvas", () => {
  it("moves a panel one column when its header is dragged that far", async () => {
    const onChange = await mount();
    const cell = container!.querySelector('[data-cell-id="a"]')!;
    const handle = cell.querySelector("[data-drag-handle]")!;

    await act(async () => {
      handle.dispatchEvent(pointer("pointerdown", 100, 100));
      window.dispatchEvent(pointer("pointermove", 200, 100));
      window.dispatchEvent(pointer("pointerup", 200, 100));
    });
    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as PanelSpec[];
    expect(next.find((p) => p.id === "a")).toMatchObject({ x: 1, y: 0 });
  });

  it("grows a panel downwards when its corner is dragged", async () => {
    const onChange = await mount();
    const corner = container!.querySelector('[aria-label="Resize A"]')!;

    await act(async () => {
      corner.dispatchEvent(pointer("pointerdown", 100, 100));
      window.dispatchEvent(pointer("pointermove", 100, 192)); // exactly one row
      window.dispatchEvent(pointer("pointerup", 100, 192));
    });
    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as PanelSpec[];
    expect(next.find((p) => p.id === "a")).toMatchObject({ h: 4, span: 6 });
  });

  it("shows the panel growing while the corner is dragged, not sliding away", async () => {
    await mount();
    const cell = container!.querySelector('[data-cell-id="a"]') as HTMLElement;
    const corner = cell.querySelector('[aria-label="Resize A"]')!;

    await act(async () => {
      corner.dispatchEvent(pointer("pointerdown", 100, 100));
      window.dispatchEvent(pointer("pointermove", 100, 284)); // two rows
    });

    // Live feedback is width/height on the cell — a translate here would read as a move.
    expect(cell.style.height).toBe("452px"); // (3 + 2) rows * 92 - 8px gap
    expect(cell.style.transform).toBe("");

    await act(async () => {
      window.dispatchEvent(pointer("pointerup", 100, 284));
    });
    await settle();
  });

  it("does not rewrite the layout for a click that never moved", async () => {
    const onChange = await mount();
    const handle = container!.querySelector('[data-cell-id="a"] [data-drag-handle]')!;

    await act(async () => {
      handle.dispatchEvent(pointer("pointerdown", 100, 100));
      window.dispatchEvent(pointer("pointerup", 100, 100));
    });
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("positions every panel on the 12-column canvas", async () => {
    await mount(vi.fn(), false);
    expect(container!.querySelector("[data-dashboard-grid]")).toBeTruthy();
    expect(container!.querySelector('[data-cell-id="a"]')!.getAttribute("data-cell")).toBe("0,0,6,3");
    expect(container!.querySelector('[data-cell-id="b"]')!.getAttribute("data-cell")).toBe("6,0,6,3");
  });
});
