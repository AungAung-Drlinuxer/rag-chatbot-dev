/**
 * Board geometry for the Overview page.
 *
 * The board is a 12-column grid of horizontal bands. Everything the resize handles need to
 * know is derived here, in pure functions, so the arithmetic is testable without a DOM:
 *
 *   packBands()      place panels left-to-right inside each band (what CSS does implicitly)
 *   resizeSpan()     move a boundary between two neighbours in a band ("w" / "e")
 *   resizeBand()     trade height between two bands ("n" / "s")
 *   boardRows()      the `grid-template-rows` value a band set produces
 *
 * A band is always full: spans in a band add up to 12. That is what makes "resize" a
 * question of *who gives up the space* rather than free placement, and it is why a board
 * can never be dragged into holes or overlaps.
 */

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Every edge a handle can sit on, in the order the ring draws them. */
export const ALL_RESIZE_EDGES: readonly ResizeEdge[] = [
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
];

/** The narrowest a panel may become: two columns, enough for a title and one number. */
export const MIN_SPAN = 2;

/** Below this a band stops being a panel and becomes a caption. */
export const MIN_BAND_FR = 0.25;

/** Height floor a band may be dragged to, and the ceiling that keeps one band sane. */
export const MIN_BAND_PX = 60;
export const MAX_BAND_PX = 1200;

export const COLUMNS = 12;

export type BandSpec = {
  /** Floor height in px, applied even when the window is short. */
  min: number;
  /** The first band is content-sized: it only holds tiles and a one-line alert. */
  auto?: boolean;
  /** Share of the leftover height. */
  fr: number;
  /** Fixed height in px — set once the user has dragged a content-sized band. */
  px?: number;
};

export const ADMIN_BANDS: readonly BandSpec[] = [
  { min: 112, auto: true, fr: 0 },
  { min: 182, fr: 0.96 },
  { min: 168, fr: 0.84 },
  { min: 200, fr: 1.18 },
];

export const USER_BANDS: readonly BandSpec[] = [
  { min: 112, auto: true, fr: 0 },
  { min: 210, fr: 1.2 },
  { min: 180, fr: 1 },
];

export function bandsFor(role: string | undefined): BandSpec[] {
  return (role === "admin" ? ADMIN_BANDS : USER_BANDS).map((b) => ({ ...b }));
}

/**
 * The `grid-template-rows` value for a band set.
 *
 * Every band is `minmax(<floor>px, auto)`: the dragged height is a **floor**, not a cap. The
 * content decides how tall a band really is, so a panel that has nine rows shows all nine and
 * the page scrolls — nothing is clipped to fit one screen.
 */
export function boardRows(bands: readonly BandSpec[]): string {
  return bands.map((b) => `minmax(${bandFloor(b)}px,auto)`).join(" ");
}

/** The height a band starts at: the dragged value, else its designed floor. */
export function bandFloor(b: BandSpec): number {
  return Math.round(b.px ?? b.min);
}

export type PanelBox = {
  id: string;
  /** 1-based band. */
  row: number;
  /** 1-based first column. */
  start: number;
  span: number;
};

type PanelLike = { id: string; span: number; row?: number };

/**
 * Place panels into bands, left to right, in array order.
 *
 * This mirrors what the grid does implicitly (`grid-row: var(--row)` plus auto-placement),
 * but writes the start column down so a resize can talk about it. A panel that would not
 * fit in the rest of its band starts on a new line inside that band instead of overflowing
 * into the next one — a malformed layout stays readable.
 */
export function packBands(panels: readonly PanelLike[]): PanelBox[] {
  const cursors = new Map<number, number>();
  return panels.map((p, index) => {
    const row = p.row ?? index + 1;
    const span = clamp(Math.round(p.span), MIN_SPAN, COLUMNS);
    let start = cursors.get(row) ?? 1;
    if (start + span - 1 > COLUMNS) start = 1;
    cursors.set(row, start + span);
    return { id: p.id, row, start, span };
  });
}

/** The panels of one band, in placement order. */
function bandMembers(boxes: readonly PanelBox[], row: number): PanelBox[] {
  return boxes.filter((b) => b.row === row);
}

/**
 * Widen or narrow one panel by `delta` columns, taking the space from the neighbour the
 * handle faces: dragging the east edge pushes into the panel on the right, dragging the
 * west edge pulls from the panel on the left. Both are clamped so neither side drops below
 * MIN_SPAN — a resize that runs out of room simply stops.
 *
 * Returns a new box list; the caller re-packs, so a band stays full and gapless.
 */
export function resizeSpan(
  boxes: readonly PanelBox[],
  id: string,
  edge: "e" | "w",
  delta: number,
): PanelBox[] {
  const target = boxes.find((b) => b.id === id);
  if (!target || delta === 0) return boxes as PanelBox[];

  const members = bandMembers(boxes, target.row);
  const index = members.findIndex((b) => b.id === id);
  const neighbour = index + (edge === "e" ? 1 : -1);
  const other = members[neighbour];
  if (!other) return boxes as PanelBox[];

  // Room available before either side hits the floor.
  const grow = Math.max(0, Math.min(delta, other.span - MIN_SPAN));
  const shrink = Math.max(delta, -(target.span - MIN_SPAN));
  const applied = delta > 0 ? grow : shrink;
  if (applied === 0) return boxes as PanelBox[];

  const next = boxes.map((b) =>
    b.id === id ? { ...b, span: b.span + applied }
      : b.id === other.id ? { ...b, span: b.span - applied }
        : b);
  return packBands(next);
}

/**
 * Trade height between a band and its neighbour(s), in pixels.
 *
 * Heights are a band property, not a panel one, so every panel in a band moves together.
 * The value is a floor: dragging grows the minimum, and content longer than it still expands
 * the band — the board never clips a panel to keep a one-screen layout.
 *
 * A band with a neighbour below gives/takes from it; the last band's south edge takes from
 * every band above, in proportion to the room each has left, so the bottom panel can always
 * be made taller.
 */
export function resizeBand(
  bands: readonly BandSpec[],
  row: number,
  edge: "n" | "s",
  deltaPx: number,
): BandSpec[] {
  const index = row - 1;
  if (index < 0 || index >= bands.length || !deltaPx) return bands as BandSpec[];

  const neighbour = index + (edge === "s" ? 1 : -1);
  const donors = neighbour >= 0 && neighbour < bands.length
    ? [neighbour]
    : bands.map((_, i) => i).filter((i) => i !== index);

  const capacity = donors.reduce(
    (sum, i) => sum + Math.max(0, bandFloor(bands[i]) - MIN_BAND_PX),
    0,
  );
  const canGive = Math.max(0, bandFloor(bands[index]) - MIN_BAND_PX);
  const applied = deltaPx > 0 ? Math.min(deltaPx, capacity) : -Math.min(-deltaPx, canGive);
  if (Math.round(applied) === 0) return bands as BandSpec[];

  const move = (b: BandSpec, px: number): BandSpec => {
    const next = clamp(Math.round(px), MIN_BAND_PX, MAX_BAND_PX);
    return { ...b, auto: false, fr: 0, px: next, min: Math.min(b.min, next) };
  };

  return bands.map((b, i) => {
    if (i === index) return move(b, bandFloor(b) + applied);
    if (!donors.includes(i) || capacity === 0) return b;
    const share = (bandFloor(b) - MIN_BAND_PX) / capacity;
    return move(b, bandFloor(b) - applied * share);
  });
}

/** Which edges of a panel get a handle for a given configuration. */
export function edgesOnPanel(
  enabled: readonly ResizeEdge[],
  edge: ResizeEdge,
): boolean {
  return enabled.includes(edge);
}

/** True when any vertical edge is configured — the band heights then become draggable. */
export function hasVerticalEdges(enabled: readonly ResizeEdge[]): boolean {
  return enabled.some((e) => e.includes("n") || e.includes("s"));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
