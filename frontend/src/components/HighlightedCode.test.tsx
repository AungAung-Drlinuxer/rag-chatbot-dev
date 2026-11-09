import { describe, expect, it } from "vitest";
import { sanitizeShikiHtml } from "./HighlightedCode";

describe("sanitizeShikiHtml", () => {
  it("keeps the markup shiki emits", () => {
    const html = '<pre class="shiki"><code><span style="color:#333">SELECT 1</span></code></pre>';
    expect(sanitizeShikiHtml(html)).toBe(html);
  });

  it("drops a script tag and its body", () => {
    const out = sanitizeShikiHtml('<pre>x</pre><script>alert(1)</script>');
    expect(out).toBe("<pre>x</pre>");
    expect(out).not.toContain("alert");
  });

  it("drops event handlers", () => {
    expect(sanitizeShikiHtml('<span onclick="steal()">x</span>')).toBe("<span>x</span>");
    expect(sanitizeShikiHtml("<img src=x onerror=alert(1)>")).toBe("<img src=x>");
  });

  it("drops javascript: urls", () => {
    expect(sanitizeShikiHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
  });

  it("drops an unclosed script tag", () => {
    expect(sanitizeShikiHtml("<script src=//evil>")).toBe("");
  });
});
