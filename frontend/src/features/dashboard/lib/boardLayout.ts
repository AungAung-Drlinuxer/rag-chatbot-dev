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

/** The `grid-template-rows` value for a band set. */
export function boardRows(bands: readonly BandSpec[]): string {
  return bands
    .map((b) => (b.px != null
      ? `minmax(${Math.round(b.px)}px,${Math.round(b.px)}px)`
      : b.auto || b.fr <= 0
        ? `minmax(${b.min}px,auto)`
        : `minmax(${b.min}px,${round2(b.fr)}fr)`))
    .join(" ");
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
 * Trade height between a band and its neighbour. Dragging the south edge of a panel grows
 * its band and shrinks the one below; the north edge does the reverse. Heights are a band
 * property, not a panel one, so every panel in the band moves together — that is the only
 * way a board of shared bands can stay flush.
 */
export function resizeBand(
  bands: readonly BandSpec[],
  row: number,
  edge: "n" | "s",
  deltaFr: number,
): BandSpec[] {
  const index = row - 1;
  if (index < 0 || index >= bands.length) return bands as BandSpec[];
  const from = bands[index];

  /* The last band has no neighbour below it, which used to make its south edge dead: the
     bottom panel (guardrail events) could never be made taller. Grow it by taking a share
     from every weighted band above, in proportion to what each can give up. */
  if (edge === "s" && index === bands.length - 1 && !from.auto && from.px == null) {
    const donors = bands
      .map((b, i) => ({ b, i }))
      .filter(({ b, i }) => i !== index && !b.auto && b.px == null && b.fr > MIN_BAND_FR);
    const capacity = donors.reduce((sum, { b }) => sum + (b.fr - MIN_BAND_FR), 0);
    if (capacity <= 0) return bands as BandSpec[];
    const applied = clamp(deltaFr, -(from.fr - MIN_BAND_FR), capacity);
    if (Math.abs(applied) < 0.001) return bands as BandSpec[];
    return bands.map((b, i) => {
      if (i === index) return { ...b, fr: round2(b.fr + applied) };
      const donor = donors.find((d) => d.i === i);
      if (!donor) return b;
      const share = (donor.b.fr - MIN_BAND_FR) / capacity;
      return { ...b, fr: round2(b.fr - applied * share) };
    });
  }

  const toward = index + (edge === "s" ? 1 : -1);
  if (toward < 0 || toward >= bands.length) return bands as BandSpec[];
  const to = bands[toward];
  // The content-sized band has no share to trade.
  if (from.auto || to.auto) return bands as BandSpec[];

  // Symmetric clamp: `from` may give up down to its floor (negative delta) and take from
  // `to` only as far as `to` may give up (positive delta).
  const canGive = from.fr - MIN_BAND_FR;
  const canTake = to.fr - MIN_BAND_FR;
  const applied = clamp(deltaFr, -canGive, canTake);
  if (Math.abs(applied) < 0.001) return bands as BandSpec[];

  return bands.map((b, i) => {
    if (i === index) return { ...b, fr: b.fr + applied };
    if (i === toward) return { ...b, fr: b.fr - applied };
    return b;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
