import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { clearBoardLayout, getBoardLayout, saveBoardLayout, type BoardLayout } from "../api";

type StoredLayout = BoardLayout;

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

function fingerprint(spans: Record<string, number>, bands: readonly BandSpec[]): string {
  return JSON.stringify({ spans, bands });
}

export type PanelResizeApi = {
  boxes: PanelBox[];
  rows: string;
  /** True when the board differs from the view last saved (or from the default). */
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  beginResize: (panelId: string, row: number, edge: ResizeEdge, event: React.PointerEvent<HTMLElement>) => void;
  /** Persist this view for the signed-in user, so it follows them to another browser. */
  saveView: () => Promise<void>;
  reset: () => Promise<void>;
};

/**
 * Panel resizing for the Overview board.
 *
 * The board is a full 12-column grid of bands, so a resize is always a boundary move
 * between neighbours: width handles trade columns with the panel on that side, height
 * handles trade a band's share of the leftover height with the band on that side. Nothing
 * free-floats, so the board cannot be dragged into holes or overlaps.
 *
 * Two exceptions keep the edges useful:
 *   - the content-sized top strip (the four KPI tiles) becomes a fixed-height band the first
 *     time it is dragged, so it can be made taller *or* shorter instead of being pinned;
 *   - the last band has no neighbour below, so growing it takes the space from the bands
 *     above in proportion — otherwise the bottom panel could never be extended downward.
 *
 * Geometry is written to localStorage as you drag (a reload keeps the view) and to the
 * server only when the operator presses Save view.
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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Fingerprint of the view the server last confirmed. `null` until the first read. */
  const [savedPrint, setSavedPrint] = useState<string | null>(null);

  // The server view wins over this browser's copy: it is the one the operator pressed Save on,
  // and it is what follows them to another machine.
  useEffect(() => {
    let alive = true;
    getBoardLayout()
      .then((res) => {
        if (!alive) return;
        if (res.custom && res.board?.bands?.length) {
          setSpans(res.board.spans ?? {});
          setBands(res.board.bands);
          setSavedPrint(fingerprint(res.board.spans ?? {}, res.board.bands));
          setSavedAt(res.updated_at);
        } else {
          const local = load(String(role));
          setSavedPrint(
            local ? fingerprint(local.spans, local.bands) : null,
          );
        }
      })
      .catch(() => {
        /* offline: the localStorage copy still opens the board */
      });
    return () => {
      alive = false;
    };
  }, [role]);

  const boxes = useMemo(
    () => packBands(panels.map((p) => ({ id: p.id, span: spans[p.id] ?? p.span, row: p.row }))),
    [panels, spans],
  );
  const rows = useMemo(() => boardRows(bands), [bands]);

  const current = useMemo(() => fingerprint(spans, bands), [spans, bands]);
  const defaultPrint = useMemo(
    () => fingerprint({}, bandsFor(role)),
    [role],
  );
  const dirty = current !== (savedPrint ?? defaultPrint);

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

    // A content-sized band has no share to trade, so measure it once and turn the drag into a
    // fixed height. From then on its edge moves in pixels, which is what the pointer expects.
    const index = row - 1;
    const panelEl = event.currentTarget.closest<HTMLElement>("[data-panel]");
    const fixedFrom = startBands[index]?.px ?? null;
    const autoFrom =
      startBands[index]?.auto === true
        ? Math.round(panelEl?.getBoundingClientRect().height || startBands[index]?.min || 112)
        : null;

    const gap = parseFloat(getComputedStyle(board).columnGap || "8") || 8;
    const step = (board.clientWidth - gap * (COLUMNS - 1)) / COLUMNS + gap;
    const totalFr = startBands.reduce((sum, b) => sum + (b.auto || b.px != null ? 0 : b.fr), 0);
    const frPerPx = totalFr > 0 ? totalFr / Math.max(1, board.clientHeight) : 0;

    const horizontal = edge.includes("e") || edge.includes("w");
    const vertical = edge.includes("n") || edge.includes("s");
    const north = edge.includes("n");
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
        const dy = e.clientY - startY;
        if (autoFrom != null || fixedFrom != null) {
          const base = autoFrom ?? fixedFrom ?? 112;
          const height = Math.max(64, Math.round(base + (north ? -dy : dy)));
          nextBands = startBands.map((b, i) =>
            i === index ? { ...b, auto: false, fr: 0, px: height, min: Math.min(b.min, height) } : b,
          );
          setBands(nextBands);
          return;
        }
        const deltaFr = dy * frPerPx;
        nextBands = resizeBand(startBands, row, north ? "n" : "s", deltaFr);
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

  const saveView = useCallback(async () => {
    setSaving(true);
    try {
      const res = await saveBoardLayout({ spans, bands });
      // Adopt the server's copy: it has been clamped and rounded, and comparing the raw local
      // values against it left the board looking dirty after a successful save.
      const stored = (res?.board ?? { spans, bands }) as BoardLayout;
      const nextSpans = stored.spans ?? {};
      const nextBands = (stored.bands?.length ? stored.bands : bands) as BandSpec[];
      setSpans(nextSpans);
      setBands(nextBands);
      setSavedPrint(fingerprint(nextSpans, nextBands));
      setSavedAt(res?.updated_at ?? new Date().toISOString());
      save(String(role), { spans: nextSpans, bands: nextBands });
    } finally {
      setSaving(false);
    }
  }, [spans, bands, role]);

  const reset = useCallback(async () => {
    setSpans({});
    setBands(bandsFor(role));
    setSavedPrint(null);
    setSavedAt(null);
    try {
      localStorage.removeItem(key(String(role)));
    } catch {
      /* ignore */
    }
    await clearBoardLayout().catch(() => undefined);
  }, [role]);

  return { boxes, rows, dirty, saving, savedAt, beginResize, saveView, reset };
}
