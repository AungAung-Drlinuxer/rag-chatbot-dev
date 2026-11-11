/**
 * Auto-fit the console to the display it is running on.
 *
 * A browser cannot report a monitor's physical size: a 21.5" and a 24" screen at 1920x1080
 * send exactly the same `screen.width`, `screen.height` and `devicePixelRatio`, so no code can
 * tell them apart — nothing here pretends to. What a browser does report is *when the display
 * changed* (different pixel geometry or density) and how much CSS room the window has. This
 * scales the interface from those, so the same console keeps a similar physical size from a
 * 1366 laptop through a 1080p 24" to a 4K screen, and a 21.5"/24" pair at one resolution
 * deliberately stays identical.
 *
 * Why `zoom` and not a font-size: every size in this app is px (a deliberate design token
 * choice), so raising the root font size would move nothing. `zoom` scales type, borders,
 * icons and spacing together, which is what "the same interface, a different screen" means.
 */

export const FIT_STORAGE_KEY = "ith:auto-fit";
/** The width the design was drawn at; at this size the scale is exactly 1. */
export const FIT_BASE_WIDTH = 1440;

export type FitInput = {
  /** The whole screen in CSS px (`window.screen.width`). */
  screenWidth: number;
  /** The window in CSS px (`window.innerWidth`). */
  innerWidth: number;
  /** `window.devicePixelRatio` — 2 on a HiDPI/zoomed display. */
  dpr: number;
};

/**
 * A gentle curve, not a linear stretch: at 1080p (1920 CSS px) it lands on 1.1, at 1440 it is
 * 1.0, at a 4K screen (1920 CSS px at dpr 2) it stays 1.0 because the pixels are already dense.
 * Clamped so a half-screen window never shrinks the text into unreadability and a huge display
 * never inflates it.
 */
export function fitScale({ screenWidth, innerWidth, dpr }: FitInput): number {
  // A window can be wider than the screen (multi-monitor, or a browser that reports a stale
  // screen): the room actually available is the larger of the two.
  const screenCss = Math.max(screenWidth, innerWidth) || FIT_BASE_WIDTH;
  const density = screenCss / FIT_BASE_WIDTH;
  // Dense displays already draw finer; scaling them up again would look oversized.
  const densityPenalty = dpr >= 1.5 ? 0.9 : 1;
  const raw = Math.pow(density, 0.35) * densityPenalty;
  const clamped = Math.min(1.2, Math.max(0.9, raw));
  return Math.round(clamped * 20) / 20; // 0.05 steps
}

export function autoFitEnabled(): boolean {
  try {
    return localStorage.getItem(FIT_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoFit(on: boolean): void {
  try {
    localStorage.setItem(FIT_STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the session simply keeps the current scale */
  }
}

/** Apply a scale (1 removes the override entirely, so the CSS default wins). */
export function applyFitScale(scale: number): void {
  const root = document.documentElement;
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 0.001) {
    root.style.removeProperty("--ui-scale");
    return;
  }
  root.style.setProperty("--ui-scale", String(scale));
}

/** The display signature that changes when the window moves to another monitor. */
export function displaySignature(): string {
  const s = window.screen;
  return [s.width, s.height, s.availWidth, s.availHeight, window.devicePixelRatio].join("x");
}
