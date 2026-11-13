/**
 * PageErrorBoundary — a page that fails must say so, not blank the app.
 *
 * Route-level chunks are fetched on demand, and after every deploy the old chunk file
 * names disappear. A tab that was left open therefore asks for a file that no longer
 * exists, the lazy import rejects, and with no boundary React unmounts the whole tree —
 * the user sees an empty white page with no sidebar and no way back.
 *
 * The boundary keeps the shell alive, names the failure, and offers two recoveries:
 * reload (which picks up the new index.html) or retry (which re-mounts the page and may
 * succeed if the chunk is cached now).
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

type Props = { children: ReactNode; resetKey?: string };
type State = { error: Error | null };

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the detail in the console for support; the user gets a plain sentence.
    console.error("page failed to render", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating elsewhere should clear the error instead of pinning the same page.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const looksLikeChunk = /dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i.test(
      `${error.name} ${error.message}`,
    );

    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 text-center shadow-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[var(--danger)]/12 text-[var(--danger)]">
            <AlertTriangle className="size-5" />
          </span>
          <h2 className="mt-4 text-base font-semibold text-foreground">
            {looksLikeChunk ? "This page could not be loaded" : "Something went wrong on this page"}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {looksLikeChunk
              ? "The app was updated while this tab was open, so part of it is out of date. Reloading will fix it."
              : "The rest of the workspace still works. Try this page again, or reload if it keeps failing."}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3.5 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-95"
            >
              <RotateCw className="size-4" /> Reload
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] px-3.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default PageErrorBoundary;
