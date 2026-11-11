/**
 * AgentActivity — animated "the assistant is working" indicator.
 *
 * Replaces the blank skeleton bubble that used to sit in the assistant row while
 * the RAG pipeline ran. Instead of dead grey bars it shows what the agent is
 * actually doing, with real motion:
 *
 *   brand avatar + orbiting ring + halo pulse
 *   stage icon that changes as the pipeline advances
 *   shimmering label: Thinking -> Rewriting your question -> Searching the
 *   knowledge base -> Researching the best sources -> Writing the answer
 *   elapsed seconds
 *
 * The stage can be driven by an explicit key or inferred from the backend's
 * free-text stage detail.
 */
import {
  Brain,
  WandSparkles,
  Search,
  Library,
  PenLine,
  Bot,
  type LucideIcon,
} from "lucide-react";

export type ActivityStage =
  | "thinking"
  | "rewriting"
  | "searching"
  | "researching"
  | "writing";

type StageDef = {
  key: ActivityStage;
  label: string;
  icon: LucideIcon;
  /** short verb shown next to the icon in compact mode */
  chip: string;
};

const STAGES: StageDef[] = [
  { key: "thinking", label: "Thinking", icon: Brain, chip: "Thinking" },
  { key: "rewriting", label: "Rewriting your question", icon: WandSparkles, chip: "Rewriting" },
  { key: "searching", label: "Searching the knowledge base", icon: Search, chip: "Searching" },
  { key: "researching", label: "Researching the best sources", icon: Library, chip: "Researching" },
  { key: "writing", label: "Writing the answer", icon: PenLine, chip: "Writing" },
];

/** Accepts either a canonical key or the backend's free-text stage detail. */
export function stageFromText(text?: string | null): ActivityStage {
  const t = (text || "").toLowerCase();
  if (/generat|writing|answer|stream|token|llm|model/.test(t)) return "writing";
  if (/rerank|scor|confidence|fuse|research/.test(t)) return "researching";
  if (/retriev|search|vector|bm25|hnsw|hybrid|knowledge|context|chunk/.test(t)) return "searching";
  if (/rewrit|refin|query|fuse|understanding|analyz|guardrail/.test(t)) return "rewriting";
  return "thinking";
}

export function stageLabel(key: ActivityStage): string {
  return STAGES.find((s) => s.key === key)?.label ?? "Thinking";
}

export default function AgentActivity({
  stage = "thinking",
  detail,
  elapsedMs,
  compact = false,
  className = "",
}: {
  stage?: ActivityStage;
  /** raw backend detail — shown as a secondary line when it adds information */
  detail?: string;
  elapsedMs?: number;
  /** tight layout for the floating widget */
  compact?: boolean;
  className?: string;
}) {
  const def = STAGES.find((s) => s.key === stage) ?? STAGES[0];
  const Icon = def.icon;
  const seconds = elapsedMs != null ? Math.round(elapsedMs / 1000) : null;

  const extra =
    detail && detail.trim() && detail.trim().toLowerCase() !== def.label.toLowerCase()
      ? detail.trim()
      : null;

  return (
    <div
      className={`flex items-center gap-2.5 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={def.label}
    >
      {/* brand avatar with orbiting ring + halo */}
      <span className="relative grid size-7 shrink-0 place-items-center rounded-xl bg-blue-600 text-white shadow-sm">
        <Bot className={compact ? "size-3.5" : "size-4"} />
        <span aria-hidden className="agent-halo absolute inset-0 rounded-xl bg-blue-500/30" />
        <span
          aria-hidden
          className="agent-orbit absolute -inset-[3px] rounded-[0.85rem] border-2 border-transparent"
          style={{
            borderTopColor: "rgba(59,130,246,0.9)",
            borderRightColor: "rgba(59,130,246,0.35)",
          }}
        />
      </span>

      {/*
        Stage icon — keyed on the stage so the swap replays the pop animation.
        A WHITE glyph on a SOLID disc, the same language the RAG pipeline strip uses
        for its steps: both describe one pipeline, so they read the same way. A pale
        square with a blue-tinted glyph made the two indicators look unrelated.
      */}
      <span
        key={def.key}
        className="agent-icon-pop relative grid size-6 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-sm"
        title={def.label}
      >
        <Icon className="size-3.5" strokeWidth={2.2} />
      </span>

      {/* shimmering label */}
      <span className="flex min-w-0 flex-col">
        <span className="agent-shimmer-text truncate text-xs font-medium text-slate-700 dark:text-slate-200">
          {compact ? def.chip : def.label}
        </span>
        {extra && !compact && (
          <span className="mt-0.5 truncate text-xs text-muted-foreground">{extra}</span>
        )}
      </span>

      {/* trailing animated dots */}
      <span aria-hidden className="ml-0.5 flex items-center gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="agent-dot size-1 rounded-full bg-blue-500 dark:bg-blue-400"
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </span>

      {seconds != null && seconds > 0 && (
        <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {seconds}s
        </span>
      )}
    </div>
  );
}