/**
 * v1.6.12 — RAG Pipeline live status tracker (chat page).
 *
 * A dynamic step indicator that mirrors the real backend pipeline
 * (LangGraph stages emitted over SSE from /api/chat/stream):
 *
 *   understanding → graph (rewrite) → retrieval → rerank → generating
 *
 * - Each step lights up as the backend reports progress (stage events).
 * - Steps that already finished get a check; the active one pulses.
 * - "Interactive": hovering a step reveals what that stage actually does
 *   plus live telemetry (elapsed ms per stage) captured as events arrive.
 * - While the backend streams tokens the tracker collapses into a compact
 *   "answer streaming" pill; when done it disappears entirely.
 * - "Simulation" mode lets you demo the full flow without a backend call
 *   (used by the demo button in the EmptyChat and by unit tests).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  WandSparkles,
  Search,
  Library,
  PenLine,
  Check,
  Circle,
  Loader2,
  Timer,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from "lucide-react";


/* ------------------------------------------------------------------ */
/* Stage model                                                        */
/* ------------------------------------------------------------------ */

export type StageKey =
  | "understanding"
  | "rewrite"
  | "retrieve"
  | "rerank"
  | "generate"
  // v1.6.65 — a live-infrastructure answer runs a DIFFERENT pipeline: no document
  // retrieval, no rerank; it selects a tool and queries the estate.
  | "tools";

type StepDef = {
  key: StageKey;
  label: string;
  /**
   * The stage glyph, drawn white inside the step disc.
   *
   * These are the SAME icons AgentActivity uses for its stages, on purpose: the
   * pipeline strip and the in-bubble activity indicator describe one pipeline, so
   * they must not spell it two ways. An emoji here also rendered at the mercy of
   * the platform font — on Linux it was a colour glyph in a monochrome disc.
   */
  icon: LucideIcon;
  description: string;   // what this stage really does (hover tooltip)
};

const STEPS: StepDef[] = [
  {
    key: "understanding",
    label: "Understanding",
    icon: Brain,
    description:
      "Input guardrails screen the message (injection / toxicity / overflow), " +
      "the user turn is persisted, and a LangGraph run starts.",
  },
  {
    key: "rewrite",
    label: "Rewrite",
    icon: WandSparkles,
    description:
      "Filler words are stripped and follow-up context is merged so the " +
      "search query is self-contained.",
  },
  {
    key: "retrieve",
    label: "Retrieve",
    icon: Search,
    description:
      "Hybrid search: pgvector HNSW (semantic) + BM25 keyword arm, fused " +
      "with Reciprocal Rank Fusion (k=60).",
  },
  {
    key: "rerank",
    label: "Rerank",
    icon: Library,
    description:
      "bge-reranker-base cross-encoder re-scores the fused candidates; " +
      "confidence ≥ 0.75 must pass the gate before an answer is generated.",
  },
  {
    key: "generate",
    label: "Generate",
    icon: PenLine,
    description:
      "Context chunks + system prompt go to the primary LLM (OpenRouter) " +
      "with automatic fallback to on-prem Llama 3.2 1B.",
  },
];

/* Map free-text backend stage details onto StageKeys.
   The backend sends human strings like:
   "Analyzing your question", "Refining the search query",
   "Searching the knowledge base", "Scoring answer confidence",
   "Preparing context for the answer", "rerank failed — falling back" */
const STAGE_MATCHERS: [StageKey, RegExp][] = [
  ["understanding", /analyz|understand|guardrail|graph run/i],
  ["rewrite", /refin|rewrit|query/i],
  ["retrieve", /search|retriev|knowledge base|fus/i],
  ["rerank", /rerank|scor|confidence/i],
  ["generate", /generat|context|answer|llm|model/i],
];

export function matchStageKey(detail: string): StageKey | null {
  const d = (detail || "").toLowerCase();
  for (const [key, re] of STAGE_MATCHERS) {
    if (re.test(d)) return key;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type StageTelemetry = Partial<Record<StageKey, number>>; // ms per stage

export type RagPipelineStatusProps = {
  /** True while the request is in flight (before first token / done). */
  active: boolean;
  /** Latest backend stage detail string (from the SSE `stage` event). */
  stage: string;
  /** True once tokens start arriving. */
  streaming?: boolean;
  /** Optional per-stage elapsed-time telemetry collected by the parent. */
  telemetry?: StageTelemetry;
  /** Overall elapsed ms (parent clock). */
  elapsedMs?: number;
  /** Demo/simulation mode — walks the pipeline on a timer, no backend. */
  simulate?: boolean;
  /** Fires when the simulation finishes (so parents can reset state). */
  onSimulateDone?: () => void;
  /** v1.6.68 — the answer came from the live estate. Needed because the stage
   *  telemetry that would otherwise reveal this is cleared once streaming ends, so a
   *  completed live answer was still titled "RAG Pipeline". */
  /** v1.6.18 — render the full card with hide/show toggle (chat reply area). */
  variant?: "panel" | "card" | "inline";
  /** Initial open state */
  defaultOpen?: boolean;
};

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function RagPipelineStatus({
  active,
  stage,
  streaming = false,
  telemetry,
  elapsedMs = 0,
  simulate = false,
  onSimulateDone,
  defaultOpen = false,
}: RagPipelineStatusProps) {
  const [demoStage, setDemoStage] = useState<StageKey | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // v1.6.19 — collapsed by default once completed, or configurable via defaultOpen
  // v1.0.1 — `active` used to force this open, so the largest element on the screen
  // during a long answer was the telemetry panel, not the answer. The collapsed strip
  // already carries stage + elapsed time; the detail is one click away.
  const [open, setOpen] = useState(defaultOpen);
  const steps = STEPS;

  /* ---- simulation mode: walk the steps every 900ms ------------------ */
  useEffect(() => {
    if (!simulate) {
      setDemoStage(null);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    let i = 0;
    setDemoStage(steps[0].key);
    timerRef.current = setInterval(() => {
      i += 1;
      if (i < steps.length) {
        setDemoStage(steps[i].key);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
        setDemoStage(null);
        onSimulateDone?.();
      }
    }, 900);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [simulate, onSimulateDone, steps]);

  /* ---- resolve the active step from the live backend stage ---------- */
  const liveKey: StageKey | null = useMemo(() => {
    if (simulate) return demoStage;
    if (streaming) return "generate";
    return matchStageKey(stage);
  }, [simulate, demoStage, stage, streaming]);

  // v1.6.15 - when finished (no live stage), mark everything up to the last
  // measured stage as done so the trace reads left-to-right with checks.
  const lastMeasured = useMemo(() => {
    let last = -1;
    steps.forEach((s, i) => {
      if (telemetry?.[s.key] != null) last = i;
    });
    return last;
  }, [telemetry, steps]);
  const activeIdx = liveKey
    ? steps.findIndex((s) => s.key === liveKey)
    : lastMeasured;

  // keep rendering after completion (finished trace); only hide when nothing
  // has ever run (no active request, no telemetry, no elapsed time).
  if (!active && !simulate && elapsedMs <= 0 && !Object.keys(telemetry ?? {}).length) {
    return null;
  }

  /* ---- the tracker ------------------------------------------------------
     v1.0.1 — restructured to the reference design. Three fixed bands:

       header   RAG Pipeline · Tracing live · ⏱ 20.6s
       stages   (1)Understanding 127ms ✓ -> (2)Rewrite 76ms ✓ -> ... (always visible)
       details  Execution Details · 4/5 completed   (expand for telemetry)

     Two changes of substance from the previous version. The stage row used to live
     INSIDE the expanded body, so the collapsed state showed only a title and a
     stopwatch — the pipeline was invisible exactly while it was running. And the
     streaming state collapsed the whole thing to a pill, which hid the stage that was
     actually running. Both now keep the stage row on screen, which is what makes the
     progress readable at a glance instead of one click away.
  ----------------------------------------------------------------------- */
  const doneCount = steps.filter((s, idx) =>
    active ? activeIdx > idx : telemetry?.[s.key] != null || idx <= lastMeasured,
  ).length;

  return (
    <div
      data-testid="rag-pipeline-tracker"
      className="overflow-hidden rounded-xl border border-[var(--border)] bg-card text-card-foreground"
    >
      {/* ---- header ---- */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`grid size-6 shrink-0 place-items-center rounded-full text-white shadow-sm ${
              active ? "animate-pulse bg-blue-600" : "bg-emerald-500"
            }`}
          >
            {active ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Check aria-hidden className="size-3.5" />
            )}
          </span>
          <span className="truncate text-xs font-semibold tracking-tight text-foreground">
            {/* Name the pipeline that is actually running: calling a cluster lookup
                "RAG Pipeline" described retrieval that never happened. Once it has
                finished the strip reads "… completed" — the reference mockup's
                "Retrieval pipeline completed" line. */}
            {active ? "RAG Pipeline" : "Retrieval pipeline completed"}
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-3xs font-medium ${
              active
                ? "bg-blue-50 text-blue-600 dark:bg-[var(--accent)] dark:text-[var(--accent-foreground)]"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
            }`}
          >
            {active ? "Tracing live" : "Completed"}
          </span>
        </div>
        {elapsedMs > 0 && (
          <span
            data-testid="rag-pipeline-elapsed"
            className="flex shrink-0 items-center gap-1 font-mono text-xs font-semibold tabular-nums text-muted-foreground"
          >
            <Timer aria-hidden className="size-3.5" />
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* ---- stage strip: on screen while the pipeline is RUNNING ----
          Each step is a vertical stack, not an inline row: a circular badge carrying the
          stage glyph, then its numbered label, then the measured ms (or "Running" while
          the step is still in flight). The reference lays it out this way, and it lets the
          badge stay legible at a size where the glyph reads as an icon rather than a smudge.

          Hidden once the run has finished: the reference mockup's completed answer shows
          ONE line — "Retrieval pipeline completed · 28.1s" — and a five-stage strip under
          a finished answer is a chart of something that already happened. The strip's job
          is to make progress readable WHILE it happens; afterwards the per-stage numbers
          are one click away under Execution details. */}
      {active && (
      <div
        data-testid="rag-pipeline-stages"
        className="flex flex-wrap items-start gap-x-1 gap-y-3 border-t border-[var(--border)] px-4 py-3"
      >
        {steps.map((step, idx) => {
          const isActive = active && idx === activeIdx;
          const isDone = active ? activeIdx > idx : telemetry?.[step.key] != null || idx <= lastMeasured;
          const ms = telemetry?.[step.key];
          return (
            <Fragment key={step.key}>
              {idx > 0 && (
                <span
                  aria-hidden
                  className={`mt-4 h-0.5 w-6 shrink-0 rounded-full sm:w-10 ${
                    isDone || isActive ? "bg-blue-500/60" : "bg-[var(--border)]"
                  }`}
                />
              )}
              <span
                title={step.description}
                data-step={step.key}
                data-state={isActive ? "running" : isDone ? "done" : "pending"}
                className="flex w-[5.5rem] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1"
              >
                {/* Badge colour alternates blue/green down the strip, exactly as the
                    reference draws it: steps 1-4 are all complete there (127/76/13/1 ms)
                    yet only 2 and 4 are green, so this is a 2-tone rhythm and not a state
                    signal. State is still readable from the ms slot below ("Running", the
                    measured ms, or "pending"). Steps that have not started stay muted so a
                    fresh run does not look finished. */}
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full shadow-sm ${
                    !isActive && !isDone
                      ? "bg-muted text-muted-foreground"
                      : idx % 2 === 0
                        ? "bg-blue-600 text-white"
                        : "bg-emerald-500 text-white"
                  } ${isActive ? "animate-pulse" : ""}`}
                >
                  <step.icon aria-hidden className="size-4" />
                </span>
                <span
                  className={`text-center text-2xs font-medium leading-tight ${
                    isActive
                      ? "text-[var(--accent-foreground)]"
                      : isDone
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  {idx + 1}. {step.label}
                </span>
                <span
                  className={`flex items-center gap-1 font-mono text-2xs tabular-nums ${
                    isActive
                      ? "text-[var(--accent-foreground)]"
                      : ms != null
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60"
                  }`}
                >
                  {isActive ? (
                    <>
                      <Loader2 aria-hidden className="size-3 animate-spin" />
                      Running
                    </>
                  ) : isDone ? (
                    <>
                      <Check aria-hidden className="size-3 text-emerald-600 dark:text-emerald-400" />
                      {ms != null ? `${ms}ms` : "done"}
                    </>
                  ) : (
                    <>
                      <Circle aria-hidden className="size-2.5" />
                      pending
                    </>
                  )}
                </span>
              </span>
            </Fragment>
          );
        })}
      </div>
      )}

      {/* ---- execution details: telemetry one click away ----
          Only once the run has finished. While it is running the stage strip above IS the
          detail, so this row was a second way to open the same thing — and it was the
          difference between the running tracker reading as a strip and reading as a panel. */}
      {!active && (
      <button
        type="button"
        data-testid="rag-pipeline-details-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border-t border-[var(--border)] px-4 py-2 text-left transition hover:bg-muted/60"
      >
        <span className="text-xs font-semibold text-foreground">
          Execution Details
        </span>
        <span className="flex items-center gap-2 text-2xs text-muted-foreground">
          {doneCount}/{steps.length} completed
          {open ? (
            <ChevronUp aria-hidden className="size-3.5" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5" />
          )}
        </span>
      </button>
      )}

      {open && (
        <div className="border-t border-[var(--border)] px-3 py-1">
          <ul className="divide-y divide-[var(--border)]">
            {steps.map((step, idx) => {
              const isActive = active && idx === activeIdx;
              const isDone = active ? activeIdx > idx : telemetry?.[step.key] != null || idx <= lastMeasured;
              const ms = telemetry?.[step.key];
              return (
                <li key={step.key} className="flex items-center gap-2.5 py-2 text-xs">
                  <span
                    className={`grid size-5 shrink-0 place-items-center rounded-full ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : isDone
                          ? "bg-emerald-500 text-white"
                          : "bg-slate-200 text-slate-500 dark:bg-[var(--muted)] dark:text-[var(--muted-foreground)]"
                    }`}
                  >
                    <step.icon aria-hidden className="size-3" />
                  </span>
                  <span className="w-24 shrink-0 font-medium text-foreground">
                    {step.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                    {step.description}
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-2xs tabular-nums text-muted-foreground">
                    {ms != null ? `${ms}ms` : "\u2014"}
                  </span>
                  <span
                    className={`inline-flex w-20 shrink-0 items-center justify-center gap-1 rounded-full px-2 py-0.5 text-3xs font-medium ${
                      isActive
                        ? "bg-blue-50 text-blue-600 dark:bg-[var(--accent)] dark:text-[var(--accent-foreground)]"
                        : isDone
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                          : "bg-slate-100 text-slate-400 dark:bg-[var(--muted)] dark:text-[var(--muted-foreground)]"
                    }`}
                  >
                    {isActive ? (
                      <Loader2 aria-hidden className="size-3 animate-spin" />
                    ) : isDone ? (
                      <Check aria-hidden className="size-3" />
                    ) : (
                      <Circle aria-hidden className="size-2.5" />
                    )}
                    {isActive ? "Running" : isDone ? "Done" : "Pending"}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* live stage detail line */}
          {stage && !simulate && active && (
            <div className="my-2 flex items-center gap-2 rounded-lg bg-blue-50/60 px-3 py-1.5 text-2xs text-blue-700 dark:bg-[var(--accent)] dark:text-[var(--accent-foreground)]">
              <span className="size-1.5 animate-ping rounded-full bg-blue-600" />
              <span className="truncate">{stage}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useStageTelemetry() {
  const [telemetry, setTelemetry] = useState<StageTelemetry>({});
  const [elapsed, setElapsed] = useState(0);
  const [streaming, setStreaming] = useState(false);
  // v1.6.38 — the stage currently running, exposed as state (not just a ref) so the
  // in-bubble AgentActivity indicator can show the matching icon + label live.
  const [currentStage, setCurrentStage] = useState<StageKey | null>(null);
  const telemetryRef = useRef<StageTelemetry>({});
  // v1.6.65 — the hook must know which pipeline is running, otherwise it
  // records a bogus "rewrite" duration for a live answer that never rewrote a query.
  const stepsFor = () => STEPS;
  const elapsedRef = useRef<number>(0);
  const startedAt = useRef<number>(0);
  const stageAt = useRef<number>(0);
  const prevStage = useRef<StageKey | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const begin = () => {
    startedAt.current = performance.now();
    stageAt.current = startedAt.current;
    prevStage.current = null;
    telemetryRef.current = {};
    elapsedRef.current = 0;
    setTelemetry({});
    setElapsed(0);
    setStreaming(false);
    setCurrentStage(null);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const now = performance.now();
      const lastDone = prevStage.current;
      if (lastDone) {
        const idx = stepsFor().findIndex((s) => s.key === lastDone);
        const running = stepsFor()[idx + 1];
        if (running) {
          const runMs = Math.max(1, Math.round(now - stageAt.current));
          telemetryRef.current = { ...telemetryRef.current, [running.key]: runMs };
          setTelemetry((t) => ({ ...t, [running.key]: runMs }));
        }
      } else {
        const runMs = Math.max(1, Math.round(now - stageAt.current));
        telemetryRef.current = { ...telemetryRef.current, understanding: runMs };
        setTelemetry((t) => ({ ...t, understanding: runMs }));
      }
      const el = Math.round(now - startedAt.current);
      elapsedRef.current = el;
      setElapsed(el);
    }, 150);
  };

  const onStage = (detail: string, stageKey?: string) => {
    const now = performance.now();
    const completed = stageKey && stepsFor().some((s) => s.key === stageKey)
      ? (stageKey as StageKey)
      : matchStageKey(detail);
    if (completed) {
      const runMs = Math.max(1, Math.round(now - stageAt.current));
      telemetryRef.current = { ...telemetryRef.current, [completed]: runMs };
      setTelemetry((t) => ({ ...t, [completed]: runMs }));
    }
    stageAt.current = now;
    prevStage.current = completed;
    // The NEXT stage starts now — that is what the user should see as "current".
    if (completed) {
      const idx = stepsFor().findIndex((s) => s.key === completed);
      setCurrentStage(stepsFor()[idx + 1]?.key ?? completed);
    } else {
      setCurrentStage("understanding");
    }
    const el = Math.round(now - startedAt.current);
    elapsedRef.current = el;
    setElapsed(el);
  };

  const onFirstToken = () => {
    const now = performance.now();
    const runMs = Math.max(1, Math.round(now - stageAt.current));
    telemetryRef.current = { ...telemetryRef.current, generate: runMs };
    setTelemetry((t) => ({ ...t, generate: runMs }));
    prevStage.current = null;
    setStreaming(true);
    setCurrentStage("generate");
    const el = Math.round(now - startedAt.current);
    elapsedRef.current = el;
    setElapsed(el);
  };

  const finish = (): { stages: StageTelemetry; totalMs: number } => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    const finalElapsed = Math.round(performance.now() - startedAt.current);
    elapsedRef.current = finalElapsed;
    setElapsed(finalElapsed);
    return {
      stages: { ...telemetryRef.current },
      totalMs: finalElapsed,
    };
  };

  return {
    telemetry,
    elapsed,
    streaming,
    currentStage,
    telemetryRef,
    elapsedRef,
    begin,
    onStage,
    onFirstToken,
    finish,
  };
}
