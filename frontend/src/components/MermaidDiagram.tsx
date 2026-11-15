import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * A ```mermaid fence from the assistant, drawn as a diagram.
 *
 * Three things matter here:
 *  1. Mermaid is ~500 KB, so it is imported the first time a diagram actually appears — a
 *     chat page that never draws one pays nothing for it.
 *  2. `securityLevel: "strict"` + `htmlLabels: false`: the definition comes from a model, so it
 *     is untrusted input. Strict mode refuses click handlers and raw HTML inside labels.
 *  3. If Mermaid throws (a model can always emit a broken edge), the reader still gets the
 *     source in a copyable block plus a short line saying why — never an empty white card.
 */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

function isDark() {
  const root = document.documentElement;
  if (root.dataset.theme === "dark") return true;
  if (root.dataset.theme === "light") return false;
  return root.classList.contains("dark");
}

/** Mermaid's own theme, derived from the app's tokens so the diagram belongs to the page. */
function themeVariables() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const dark = isDark();
  const surface = dark ? v("--card", "#191927") : "#ffffff";
  const line = dark ? v("--border", "#3B3452") : "#cbd5e1";
  const ink = dark ? v("--foreground", "#EDEAF4") : "#0f172a";
  const muted = dark ? v("--muted-foreground", "#B4AEC9") : "#475569";
  const accent = v("--primary", dark ? "#8B5CF6" : "#7c3aed");
  return {
    darkMode: dark,
    background: v("--background", dark ? "#09090F" : "#ffffff"),
    primaryColor: dark ? "rgba(139,92,246,0.18)" : "#ede9fe",
    primaryTextColor: ink,
    primaryBorderColor: accent,
    secondaryColor: dark ? "rgba(99,102,241,0.18)" : "#eef2ff",
    secondaryTextColor: ink,
    secondaryBorderColor: dark ? "#6366F1" : "#6366f1",
    tertiaryColor: surface,
    tertiaryTextColor: ink,
    tertiaryBorderColor: line,
    lineColor: dark ? "#7c7a94" : "#94a3b8",
    textColor: ink,
    mainBkg: surface,
    nodeBorder: accent,
    clusterBkg: dark ? "rgba(255,255,255,0.03)" : "#f8fafc",
    clusterBorder: line,
    edgeLabelBackground: v("--background", dark ? "#09090F" : "#ffffff"),
    titleColor: ink,
    actorTextColor: ink,
    actorBkg: surface,
    actorBorder: accent,
    signalColor: muted,
    signalTextColor: ink,
    labelBoxBkgColor: surface,
    labelBoxBorderColor: line,
    labelTextColor: ink,
    loopTextColor: ink,
    noteBkgColor: dark ? "rgba(251,191,36,0.12)" : "#fef9c3",
    noteTextColor: ink,
    noteBorderColor: dark ? "#FBBF24" : "#facc15",
    fontFamily: getComputedStyle(document.body).fontFamily || "ui-sans-serif, system-ui",
    fontSize: "13px",
  };
}

export default function MermaidDiagram({
  chart,
  compact = false,
}: {
  chart: string;
  compact?: boolean;
}) {
  const reactId = useId();
  const renderId = useMemo(() => `mmd-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [reactId]);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dark, setDark] = useState(() => (typeof document === "undefined" ? false : isDark()));
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;

    (async () => {
      const code = chart.trim();
      if (!code) return;
      try {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          theme: "base",
          themeVariables: themeVariables(),
          flowchart: { curve: "basis", useMaxWidth: true, htmlLabels: false },
          sequence: { useMaxWidth: true, mirrorActors: false, wrap: true },
          fontFamily: themeVariables().fontFamily,
        });
        // parse() gives a readable message before render() throws an SVG-shaped error.
        await mermaid.parse(code);
        const { svg: rendered } = await mermaid.render(`${renderId}-${dark ? "d" : "l"}`, code);
        if (!cancelled && alive.current) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled && alive.current) {
          setSvg(null);
          setError(err instanceof Error ? err.message : "Mermaid could not draw this diagram.");
        }
      }
    })();

    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [chart, renderId, dark]);

  /* A palette switch re-inks the diagram instead of leaving yesterday's colours on screen. */
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setDark(isDark()));
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => obs.disconnect();
  }, []);

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(chart).then(done).catch(done);
    } else {
      const ta = document.createElement("textarea");
      ta.value = chart;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* best effort */ }
      document.body.removeChild(ta);
      done();
    }
  }, [chart]);

  function download() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.svg";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <figure
      className={`group/diagram relative my-3 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-[var(--border)] dark:bg-[var(--card)] ${compact ? "text-xs" : ""}`}
      data-slot="mermaid-diagram"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-2.5 py-1 dark:border-[var(--border)] dark:bg-[var(--muted)]">
        <span className="font-mono text-3xs uppercase tracking-wider text-slate-500 dark:text-[var(--muted-foreground)]">
          diagram
        </span>
        <span className="flex items-center gap-1">
          {svg && (
            <button
              type="button"
              onClick={download}
              aria-label="Download diagram as SVG"
              title="Download SVG"
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-[var(--muted-foreground)] dark:hover:bg-[var(--card)] dark:hover:text-slate-100"
            >
              <Download className="size-3" />
            </button>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label="Copy diagram source"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-[var(--muted-foreground)] dark:hover:bg-[var(--card)] dark:hover:text-slate-100"
          >
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </div>

      {error ? (
        <div className="px-3 py-2.5">
          <p className="mb-2 flex items-start gap-1.5 text-2xs text-amber-600 dark:text-amber-400">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>This diagram has a syntax error, so it is shown as code. {error}</span>
          </p>
          <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2 font-mono text-2xs leading-relaxed text-slate-800 dark:bg-[var(--background)] dark:text-[var(--foreground)]">
            {chart}
          </pre>
        </div>
      ) : svg ? (
        <div
          className="mermaid-diagram overflow-x-auto px-3 py-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div
          className="flex items-center gap-2 px-3 py-6 text-2xs text-slate-400 dark:text-[var(--muted-foreground)]"
          role="status"
        >
          <span className="size-3 animate-pulse rounded-full bg-slate-300 dark:bg-[var(--border)]" />
          Drawing diagram…
        </div>
      )}
    </figure>
  );
}
