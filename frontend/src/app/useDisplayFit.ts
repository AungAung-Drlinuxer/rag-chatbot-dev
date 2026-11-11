/**
 * Keeps `--ui-scale` in step with the display the window is on.
 *
 * Listeners rather than a single read at boot: dragging the window from one monitor to another
 * fires `resize` (the window's CSS size changes with the screen's pixel geometry) and, when the
 * pixel ratio differs, a `(resolution: Ndppx)` media query flips. Some compositors move a
 * window without either event, so the display signature is also polled — it is five numbers, so
 * a two-second poll costs nothing.
 */
import { useEffect } from "react";

import { applyFitScale, autoFitEnabled, displaySignature, fitScale } from "@/app/displayFit";

export function useDisplayFit(): void {
  useEffect(() => {
    const compute = () => {
      if (!autoFitEnabled()) {
        applyFitScale(1);
        return;
      }
      applyFitScale(
        fitScale({
          screenWidth: window.screen?.width ?? 0,
          innerWidth: window.innerWidth,
          dpr: window.devicePixelRatio || 1,
        }),
      );
    };

    compute();

    let signature = displaySignature();
    const onMaybeDisplayChange = () => {
      const next = displaySignature();
      if (next !== signature) {
        signature = next;
        compute();
      }
    };

    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    const timer = window.setInterval(onMaybeDisplayChange, 2000);

    // A monitor with a different pixel ratio: this query stops matching on the switch.
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onDpr = () => compute();
    dprQuery.addEventListener?.("change", onDpr);

    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
      window.clearInterval(timer);
      dprQuery.removeEventListener?.("change", onDpr);
    };
  }, []);
}
