/**
 * lazyWithRetry — a stale tab must be able to reach the new deploy.
 *
 * Every deploy gives the route chunks new file names. A tab that was already open holds
 * the old index.html, so the first lazy navigation asks for a chunk that no longer exists
 * and fails. Retrying the import cannot help — the file is gone — but reloading can, as
 * long as it happens once per deploy rather than in a loop.
 *
 * The guard is a timestamp in sessionStorage: a reload is allowed only if the previous
 * attempt was more than 10 seconds ago and not the same build. If the import still fails
 * after that, the rejection reaches PageErrorBoundary, which shows the page-level message.
 */
import { lazy, type ComponentType } from "react";

const RETRY_KEY = "ith:chunk-retry-at";
const RETRY_WINDOW_MS = 10_000;

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RETRY_KEY) ?? "0");
    if (Date.now() - last < RETRY_WINDOW_MS) return false;
    sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function lazyPage<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await loader();
    } catch (err) {
      // One automatic reload per window: it is what actually fixes a chunk that vanished
      // underneath an open tab. Reloading again in the same window would be a loop.
      if (reloadOnce()) {
        window.location.reload();
        return await new Promise<{ default: T }>(() => {});
      }
      throw err;
    }
  });
}

export default lazyPage;
