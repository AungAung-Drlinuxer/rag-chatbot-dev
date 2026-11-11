import type { ResizeEdge } from "../lib/boardLayout";

type Props = {
  /** Which edges this board offers. ["w","e"] = columns only; all eight = the full ring. */
  handles: readonly ResizeEdge[];
  label: string;
  onResize: (edge: ResizeEdge, event: React.PointerEvent<HTMLElement>) => void;
};

const CURSOR: Record<ResizeEdge, string> = {
  e: "ew-resize", w: "ew-resize",
  n: "ns-resize", s: "ns-resize",
  ne: "nesw-resize", sw: "nesw-resize",
  nw: "nwse-resize", se: "nwse-resize",
};

/** Geometry per edge: [inline styles, whether the hover line runs vertical]. */
function geometry(edge: ResizeEdge): { style: React.CSSProperties; vertical: boolean } {
  const line = 3;
  switch (edge) {
    case "e": return { vertical: true, style: { right: -line, top: 10, bottom: 10, width: 10 } };
    case "w": return { vertical: true, style: { left: -line, top: 10, bottom: 10, width: 10 } };
    case "n": return { vertical: false, style: { top: -line, left: 10, right: 10, height: 10 } };
    case "s": return { vertical: false, style: { bottom: -line, left: 10, right: 10, height: 10 } };
    case "ne": return { vertical: false, style: { top: -4, right: -4, width: 16, height: 16 } };
    case "nw": return { vertical: false, style: { top: -4, left: -4, width: 16, height: 16 } };
    case "se": return { vertical: false, style: { bottom: -4, right: -4, width: 16, height: 16 } };
    case "sw": return { vertical: false, style: { bottom: -4, left: -4, width: 16, height: 16 } };
  }
}

/**
 * The drag grips on a panel's edges.
 *
 * Deliberately invisible until the pointer is over them: a dashboard that is always wearing
 * eight little dots reads as a design tool. The grip is a transparent hit area with a
 * highlight line that fades in on hover/focus, and the cursor does the rest of the telling.
 * Desktop only — the board stacks and scrolls on a phone, where there is nothing to trade.
 */
export function PanelResizeHandles({ handles, label, onResize }: Props) {
  if (handles.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 hidden lg:block" aria-hidden={false}>
      {handles.map((edge) => {
        const { style, vertical } = geometry(edge);
        return (
          <span
            key={edge}
            role="separator"
            aria-label={`Resize ${label} (${edge})`}
            aria-orientation={vertical ? "vertical" : "horizontal"}
            data-resize-edge={edge}
            className="group pointer-events-auto absolute z-20 touch-none select-none"
            style={{ ...style, cursor: CURSOR[edge] }}
            onPointerDown={(event) => onResize(edge, event)}
          >
            <span
              className={[
                "pointer-events-none absolute rounded-full bg-[var(--primary)] opacity-0 transition-opacity duration-150",
                "group-hover:opacity-60 group-active:opacity-90",
                vertical
                  ? "top-1/2 left-1/2 h-8 w-[3px] -translate-x-1/2 -translate-y-1/2"
                  : "top-1/2 left-1/2 h-[3px] w-8 -translate-x-1/2 -translate-y-1/2",
              ].join(" ")}
            />
          </span>
        );
      })}
    </div>
  );
}
