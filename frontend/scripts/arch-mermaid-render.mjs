// Render the Mermaid block in docs/architecture-current.md -> docs/architecture-mermaid.png
// via headless Chrome + mermaid.js (CDN, no CLI install). Run: cd desktop && node scripts/arch-mermaid-render.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MD = resolve(ROOT, "docs/architecture-current.md");
const OUT = resolve(ROOT, "docs/architecture-mermaid.png");
mkdirSync(dirname(OUT), { recursive: true });

// Extract the first ```mermaid ... ``` block
const md = readFileSync(MD, "utf8");
const m = md.match(/```mermaid\s*\n([\s\S]*?)```/);
if (!m) { console.log("MERMAID_FAIL no mermaid block"); process.exit(1); }
const code = m[1];

const html = `<!doctype html><html><head><meta charset="utf-8"/>
<style>body{margin:0;background:#fff;padding:20px;font-family:'Segoe UI',Arial,sans-serif}
pre.mermaid{background:transparent}.mermaid{display:flex;justify-content:center}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body><pre class="mermaid">${code}</pre>
<script>mermaid.initialize({startOnLoad:true, theme:'default', flowchart:{curve:'basis'}, securityLevel:'loose'});</script>
</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1700, height: 1600, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector(".mermaid svg", { timeout: 30000 });
  const el = await page.$(".mermaid");
  const box = await el.boundingBox();
  await page.setViewport({ width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40, deviceScaleFactor: 2 });
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 } });
  console.log("MERMAID_PNG_OK " + OUT + " size=" + Math.ceil(box.width) + "x" + Math.ceil(box.height));
} catch (e) {
  console.log("MERMAID_RENDER_FAIL " + e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
