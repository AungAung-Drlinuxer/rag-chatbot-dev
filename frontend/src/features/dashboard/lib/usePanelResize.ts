import { useCallback, useMemo, useRef, useState } from "react";
import type { PanelSpec } from "../panels/types";
import {
  COLUMNS,
  bandsFor,
  boardRows,
  packBands,
  resizeBand,
  resizeSpan,
  type BandSpec,
  type PanelBox,
  type ResizeEdge,
} from "./boardLayout";

type StoredLayout = { spans: Record<string, number>; bands: BandSpec[] };

const key = (role: string) => `ith:board-layout:v1:${role}`;

function load(role: string): StoredLayout | null {
  try {
    const raw = localStorage.getItem(key(role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLayout;
    if (!parsed?.spans || !Array.isArray(parsed.bands)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function save(role: string, value: StoredLayout) {
  try {
    localStorage.setItem(key(role), JSON.stringify(value));
  } catch {
    /* private mode or quota — the board still holds for this session */
  }
}

export type PanelResizeApi = {
  boxes: PanelBox[];
  rows: string;
  dirty: boolean;
  beginResize: (panelId: string, row: number, edge: ResizeEdge, event: React.PointerEvent<HTMLElement>) => void;
  reset: () => void;
};

/**
 * Panel resizing for the Overview board.
 *
 * The board is a full 12-column grid of bands, so a resize is always a boundary move
 * between neighbours: width handles trade columns with the panel on that side, height
 * handles trade a band's share of the leftover height with the band on that side. Nothing
 * free-floats, so the board cannot be dragged into holes or overlaps, and the result is
 * remembered per role in this browser until reset.
 *
 * Which edges exist is the caller's decision — ["w", "e"] for column-only resizing, all
 * eight for the full ring — the hook handles whichever ones it is given.
 */
export function usePanelResize(
  panels: readonly PanelSpec[],
  role: string | undefined,
): PanelResizeApi {
  const stored = useRef<StoredLayout | null | undefined>(undefined);
  if (stored.current === undefined) stored.current = load(String(role));

  const [spans, setSpans] = useState<Record<string, number>>(() => stored.current?.spans ?? {});
  const [bands, setBands] = useState<BandSpec[]>(
    () => stored.current?.bands ?? bandsFor(role),
  );

  const boxes = useMemo(
    () => packBands(panels.map((p) => ({ id: p.id, span: spans[p.id] ?? p.span, row: p.row }))),
    [panels, spans],
  );
  const rows = useMemo(() => boardRows(bands), [bands]);

  const defaultRows = useMemo(() => boardRows(bandsFor(role)), [role]);
  const dirty = useMemo(() => {
    if (rows !== defaultRows) return true;
    return panels.some((p) => (spans[p.id] ?? p.span) !== p.span);
  }, [rows, defaultRows, panels, spans]);

  const beginResize = useCallback<PanelResizeApi["beginResize"]>((panelId, row, edge, event) => {
    const board = event.currentTarget.closest<HTMLElement>("[data-board='fill']");
    if (!board) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startBoxes = boxes;
    const startBands = bands;
    const startSpans = spans;

    const gap = parseFloat(getComputedStyle(board).columnGap || "8") || 8;
    const step = (board.clientWidth - gap * (COLUMNS - 1)) / COLUMNS + gap;
    const totalFr = startBands.reduce((sum, b) => sum + (b.auto ? 0 : b.fr), 0);
    const frPerPx = totalFr > 0 ? totalFr / Math.max(1, board.clientHeight) : 0;

    const horizontal = edge.includes("e") || edge.includes("w");
    const vertical = edge.includes("n") || edge.includes("s");
    let nextSpans = startSpans;
    let nextBands = startBands;

    board.dataset.resizing = "1";
    document.body.style.userSelect = "none";

    const onMove = (e: PointerEvent) => {
      if (horizontal) {
        const delta = Math.round((e.clientX - startX) / step);
        const dir = edge.includes("w") ? "w" : "e";
        const moved = resizeSpan(startBoxes, panelId, dir, delta);
        const updated: Record<string, number> = { ...startSpans };
        for (const box of moved) {
          const original = startBoxes.find((b) => b.id === box.id);
          const base = panels.find((p) => p.id === box.id)?.span;
          if (original && base !== undefined && box.span !== original.span) {
            updated[box.id] = box.span;
          }
        }
        nextSpans = updated;
        setSpans(updated);
      }
      if (vertical) {
        const deltaFr = (e.clientY - startY) * frPerPx;
        nextBands = resizeBand(startBands, row, edge.includes("n") ? "n" : "s", deltaFr);
        setBands(nextBands);
      }
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      delete board.dataset.resizing;
      document.body.style.userSelect = "";
    };

    const onUp = () => {
      cleanup();
      save(String(role), { spans: nextSpans, bands: nextBands });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [boxes, bands, spans, panels, role]);

  const reset = useCallback(() => {
    setSpans({});
    setBands(bandsFor(role));
    try {
      localStorage.removeItem(key(String(role)));
    } catch {
      /* ignore */
    }
  }, [role]);

  return { boxes, rows, dirty, beginResize, reset };
}
