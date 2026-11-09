// Async shiki highlighter (singleton, LAZY-LOADED chunk) + <HighlightedCode>.
import { memo, useEffect, useState, type ReactNode } from "react";

let highlighterPromise: Promise<any> | null = null;
const LANGS = ["sql", "bash", "typescript", "javascript", "python", "json", "yaml", "shell"];

/** Import shiki only when the first code block actually renders. */
async function getHighlighter(): Promise<any> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(async ({ createHighlighter }) =>
      createHighlighter({ themes: ["github-light"], langs: LANGS })
    );
  }
  return highlighterPromise;
}

/** Renders pre-styled HTML from shiki; falls back to plain code until ready. */
export const HighlightedCode = memo(function HighlightedCode({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const resolved = (lang || "text").toLowerCase();

  useEffect(() => {
    let alive = true;
    getHighlighter()
      .then((h) => {
        if (!alive) return;
        try {
          // Fall back to plaintext when the language isn't loaded.
          const l = h.getLoadedLanguages().includes(resolved as never) ? resolved : "text";
          setHtml(h.codeToHtml(code, { lang: l === "text" ? "plaintext" : l, theme: "github-light" }));
        } catch {
          setHtml(null);
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [code, resolved]);

  if (html === null) return <pre><code>{code}</code></pre>;
  return <div className="shiki-block" dangerouslySetInnerHTML={{ __html: sanitizeShikiHtml(html) }} />;
});

/**
 * Shiki escapes the code it tokenises, but the string still goes through
 * `dangerouslySetInnerHTML` — one unescaped path and model output becomes markup. Keep
 * the markup shiki actually emits (`<pre>`, `<code>`, `<span style>`, `<br>`, `<div>`)
 * and drop anything that can execute.
 */
export function sanitizeShikiHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, "")
    // Event handlers and javascript: URLs.
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "");
}

/** react-markdown `components.pre` override that unwraps the child <code> element. */
export function MarkdownPre({ children }: { children?: ReactNode }) {
  const child: any = Array.isArray(children) ? children[0] : children;
  const className: string = child?.props?.className ?? "";
  const m = /language-([\w-]+)/.exec(className);
  const raw =
    typeof child?.props?.children === "string"
      ? child.props.children
      : Array.isArray(child?.props?.children)
        ? child.props.children.join("")
        : "";
  if (!m && !raw) return <pre>{children}</pre>;
  return <HighlightedCode code={raw.replace(/\n$/, "")} lang={m?.[1]} />;
}
