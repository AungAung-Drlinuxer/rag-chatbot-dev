/**
 * PageFallback — what a lazy route shows while its chunk is in flight.
 *
 * Route-level code splitting means the first visit to a page costs a network round-trip.
 * This keeps that honest: a centred spinner on the page's own background, sized to the
 * viewport so the shell (sidebar, header) never shifts when the real page mounts.
 *
 * Deliberately minimal — no card, no title. A skeleton that guesses at the page's shape
 * looks broken when the guess is wrong; a quiet spinner reads as "loading" for any page.
 */
import { Loader2 } from "lucide-react";

export function PageFallback() {
  return (
    <div
      className="flex h-full min-h-[240px] w-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <Loader2 className="size-5 animate-spin text-slate-400 dark:text-slate-500" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default PageFallback;
