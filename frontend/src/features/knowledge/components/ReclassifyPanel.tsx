/**
 * P3c — "Re-classify KB" panel for the Knowledge page.
 *
 * Shows what the LLM classifier would change before anything is written: a review
 * table of article → current domain → suggested domain with the classifier's
 * reason and confidence. The admin applies it explicitly. Applying updates both
 * kb_meta and the stored chunk metadata, so retrieval stops filtering on the old
 * domain (no re-embedding is needed — the content hash covers title and body only).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getReclassifyStatus, startReclassify, type ReclassifyStatus } from "../reclassifyApi";

export default function ReclassifyPanel({ onApplied }: { onApplied?: () => void }) {
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState<ReclassifyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const s = await getReclassifyStatus();
      setSt(s);
      if (s.state === "running") {
        timer.current = setTimeout(poll, 2500);
      }
    } catch {
      /* ignore — a failed poll is not worth surfacing */
    }
  }, []);

  // P0#4 — refresh the article list and the domain counts the moment an apply
  // completes, instead of leaving the admin to notice the list is stale.
  useEffect(() => {
    if (st?.state === "done" && st.applied && onApplied) onApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.state, st?.applied]);

  useEffect(() => {
    if (open) void poll();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, poll]);

  async function run(apply: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await startReclassify(apply, 250);
      if (!res.data.started) {
        setMsg(res.data.reason === "already running" ? "A run is already in progress." : "Could not start.");
      } else if (apply) {
        setMsg("Applying the LLM classification across the KB…");
      }
      setSt((prev) => prev && { ...prev, state: "running", applied: apply, done: 0 });
      timer.current = setTimeout(poll, 1500);
    } catch {
      setMsg("Could not start the re-classification run.");
    } finally {
      setBusy(false);
    }
  }

  const running = st?.state === "running";
  const lowCount = (st?.changes ?? []).filter((c) => c.confidence < 0.75).length;
  const pct = st && st.total > 0 ? Math.round((st.done / st.total) * 100) : 0;

  if (!open) {
    return (
      <Button
        variant="outline"
        className="h-9 gap-2 rounded-xl text-xs"
        onClick={() => setOpen(true)}
        title="Let the LLM re-check every article's domain and review the diff"
      >
        <Sparkles className="size-3.5" />
        Re-classify KB
      </Button>
    );
  }

  return (
    <div className="mb-4 w-full rounded-xl border border-[var(--border)] bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold">
            <Sparkles className="size-3.5 text-[var(--accent-foreground)]" />
            Re-classify the knowledge base
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The LLM reads each article and proposes the correct domain using the
            domain descriptions. Nothing is written until you apply it, and applying
            only moves the domain metadata — the article text is untouched.
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="rounded-md p-1 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="h-8 gap-2 rounded-lg text-xs"
          disabled={busy || running}
          onClick={() => run(false)}
        >
          {running && !st?.applied ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Preview changes
        </Button>
        <Button
          className="h-8 gap-2 rounded-lg text-xs"
          disabled={busy || running || !st || st.changed === 0}
          onClick={() => run(true)}
          title={st && st.changed === 0 ? "Run a preview first — there is nothing to apply" : undefined}
        >
          <Check className="size-3" />
          Apply {st && st.changed > 0 ? `${st.changed} change(s)` : ""}
        </Button>
        {st && st.state !== "idle" && (
          <span className="text-xs text-muted-foreground">
            {st.state === "running"
              ? `Classifying ${st.done}/${st.total} (${pct}%)…`
              : st.state === "error"
                ? `Failed: ${st.error}`
                : st.applied
                  ? `Applied ${st.applied_count ?? st.changed} change(s) across ${st.total} article(s).`
                  : `${st.changed} of ${st.total} article(s) should change` +
                    (lowCount > 0 ? ` · ${lowCount} need review (<75%)` : "")}
          </span>
        )}
      </div>

      {running && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-[var(--primary)] transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {msg && <div className="mt-2 text-xs text-muted-foreground">{msg}</div>}

      {st && st.changes.length > 0 && (
        <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/60 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Article</th>
                <th className="px-3 py-2 font-semibold">Now</th>
                <th className="px-3 py-2 font-semibold">Suggested</th>
                <th className="px-3 py-2 font-semibold">Confidence</th>
                <th className="px-3 py-2 font-semibold">Why</th>
              </tr>
            </thead>
            <tbody>
              {st.changes.map((c) => {
                /* P0#3 — confidence drives the review. A 0.70 suggestion and a 1.00
                   suggestion are not the same claim, and the re-classification run
                   moved 165 articles, so the admin needs the uncertain ones pushed to
                   the front rather than buried in a flat list. */
                const low = c.confidence < 0.75;
                return (
                  <tr key={c.page_id} className={`border-t border-[var(--border)]/60 ${low ? "bg-amber-50/60 dark:bg-amber-950/20" : ""}`}>
                    <td className="max-w-[240px] truncate px-3 py-2 font-medium">
                      {low && <AlertTriangle className="mr-1 inline size-3 text-amber-500" />}
                      {c.title}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-2xs">{c.current}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="border-[var(--primary)]/30 bg-[var(--accent-soft)] text-2xs text-[var(--accent-foreground)]">
                        {c.suggested}
                      </Badge>
                    </td>
                    <td className="w-24 px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full ${low ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${Math.round(c.confidence * 100)}%` }}
                          />
                        </div>
                        <span className={`text-2xs font-semibold ${low ? "text-amber-600" : "text-emerald-600"}`}>
                          {Math.round(c.confidence * 100)}%
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[280px] px-3 py-2 text-muted-foreground">{c.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {st?.state === "done" && st.applied && (
        <div className="mt-2 flex items-center gap-2 text-xs text-emerald-600">
          <Check className="size-3" />
          Applied. Refresh the list to see the new domains.
          {onApplied && (
            <button className="underline" onClick={onApplied}>
              Refresh now
            </button>
          )}
        </div>
      )}

      {st?.state === "error" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-rose-600">
          <AlertTriangle className="size-3" /> {st.error}
        </div>
      )}
    </div>
  );
}
