/**
 * MarkdownMessage — one renderer for every AI answer (v1.6.45).
 *
 * Why a shared component: the chat page and the floating AI Assistant each had
 * their own ReactMarkdown call with a long, drifting Tailwind class chain, so
 * answers looked subtly different in the two surfaces. This module owns the
 * presentation once.
 *
 * What it adds over a bare <ReactMarkdown>:
 *   • CODE BLOCKS with a Copy button, a language badge and a distinct surface.
 *     Commands are the main reason someone copies from an answer, so copy has to
 *     be one click and must not depend on selecting text by hand. The block is
 *     also horizontally scrollable and never wraps mid-command.
 *   • A wide TABLE scrolls sideways inside its own bordered card rather than being
 *     clipped, and the headers stay on one line.
 *   • Inline code, headings, lists and links styled to match the app.
 *   • `compact` — a tighter type scale for the 380px floating widget.
 *
 * WHAT IS DELIBERATELY ABSENT: a per-row "stacked card" layout for narrow screens.
 * It was tried, it measured correctly, and it was rejected on sight — eight labelled
 * lines per VM turns a scannable list into several screens of cards, which is exactly
 * what someone reading a 29-VM inventory does not want. A table that scrolls sideways
 * keeps the whole list scannable at any width. Do not re-introduce the stacking without
 * the user asking for it.
 */
import { useRef, useState, type ReactNode, type HTMLAttributes } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";

function CodeBlock({
  children,
  className,
  compact,
  ...rest
}: HTMLAttributes<HTMLPreElement> & { compact?: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  // Read the rendered text rather than walking the markdown AST — works for any
  // code shape (fences, indented blocks, tables) and cannot drift from what the
  // user actually sees.
  function copy() {
    const text = ref.current?.innerText ?? "";
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      // Fallback for a non-secure context where the Clipboard API is unavailable.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* best effort */ }
      document.body.removeChild(ta);
      done();
    }
  }

  const lang = /language-([\w+#-]+)/.exec(className || "")?.[1];

  return (
    <div className="group/code relative my-2.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-100/70 px-2.5 py-1 dark:border-slate-800 dark:bg-slate-800/50">
        <span className="font-mono text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 transition hover:bg-white hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        ref={ref}
        className={`overflow-x-auto px-3 py-2.5 font-mono ${compact ? "text-xs" : "text-xs"} leading-relaxed text-slate-800 dark:text-slate-100`}
        {...rest}
      >
        {children}
      </pre>
    </div>
  );
}

/**
 * A markdown table: one real table, scrollable sideways when it is wider than the bubble.
 *
 * The wrapper — not the table — owns the border and rounding so the rounded corners stay
 * put while the content scrolls, and `overscroll-x-contain` stops a sideways swipe inside
 * the table from also dragging the chat pane behind it.
 */
function Table({ children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="md-table-wrap my-3 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200 dark:border-slate-800">
      <table {...rest}>{children as ReactNode}</table>
    </div>
  );
}

const BASE = [
  "md min-w-0 max-w-full break-words [overflow-wrap:anywhere] leading-relaxed",
  "[&_p]:my-2 [&_strong]:font-semibold [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0",
  "[&_li>p]:my-0 [&_li]:pl-0.5",
  "[&_input[type=checkbox]]:mr-1.5 [&_input[type=checkbox]]:align-middle",
  "[&_ul]:list-disc [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_li]:ml-4",
  "[&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 dark:[&_blockquote]:border-slate-700",
  "[&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-slate-600 dark:[&_blockquote]:text-slate-300",
  "[&_code]:rounded [&_code]:bg-[var(--muted)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs dark:[&_code]:bg-slate-800",
  // Tables. `whitespace-nowrap` on the cells is what keeps "15.3 / 16.0 GB" on one line —
  // wrapping there made every row two lines tall and doubled the height of a 29-row list.
  "[&_table]:w-full [&_table]:border-separate [&_table]:border-spacing-0 [&_table]:text-left",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:align-top",
  "dark:[&_th]:border-slate-800 dark:[&_th]:bg-slate-800/80",
  "[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:whitespace-nowrap dark:[&_td]:border-slate-800/60",
  "[&_tr:last-child_td]:border-b-0",
  "[&_tbody_tr:hover]:bg-slate-50 dark:[&_tbody_tr:hover]:bg-slate-800/40",
  "[&_hr]:my-4 [&_hr]:border-slate-200 dark:[&_hr]:border-slate-800",
].join(" ");

export default function MarkdownMessage({
  content,
  compact = false,
  className = "",
}: {
  content: string;
  /** tighter type scale + spacing for the floating widget */
  compact?: boolean;
  className?: string;
}) {
  /* Full-page answers get a real hierarchy: a 16px heading, 14px section heads and body
     text at 14px. The old scale used `text-xs` for everything, so a long structured answer
     read as one grey block no matter how much Markdown it carried. */
  const heading = compact
    ? "[&_h1]:mt-2.5 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2.5 [&_h2]:text-xs [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold"
    : "[&_h1]:mt-4 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:leading-snug [&_h2]:mt-4 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:leading-snug [&_h3]:mt-3 [&_h3]:text-[14px] [&_h3]:font-semibold [&_h3]:uppercase [&_h3]:tracking-wide [&_h3]:text-slate-500 dark:[&_h3]:text-slate-400";

  return (
    <div className={`${BASE} ${heading} ${compact ? "text-xs" : "text-[14px]"} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // react-markdown v9 passes the <code> child through `children`; wrapping
          // `pre` is what lets us attach the copy affordance to the whole block.
          pre: (props) => <CodeBlock {...(props as HTMLAttributes<HTMLPreElement>)} compact={compact} />,
          table: (props) => <Table {...(props as HTMLAttributes<HTMLTableElement>)} />,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children as ReactNode}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
