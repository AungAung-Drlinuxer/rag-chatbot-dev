// Screenshot every Settings section.
//
// The Settings page is admin-only and behind auth, so it cannot be photographed by signing
// in. The harness renders the real page with `fetch` stubbed (src/__settings_page_harness__.tsx).
// This walks the nav and captures one full-page image per section, and reports what each
// section actually contains so the images can be checked against the DOM rather than trusted.
//
// Usage (dev server only): node scripts/settings_page_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5223;
const BASE = `http://localhost:${PORT}/settings-page-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

// The five sections the nav defines, in nav order.
// "Connectors" is gone: the settings nav no longer lists it (removed on request).
const SECTIONS = ["Preferences", "Integrations", "AI service", "Email server"];

const report = { problems: [], sections: {} };
// Format only — every call site already pushes the result. Pushing here too
// counted each failure twice, which inflated the failure count.
const fail = (m) => m;

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
// Attribute resource failures from the RESPONSE side. A harness page has no favicon, so its
// 404 arrives as a console line with no URL and cannot be told apart from a missing module
// by the message alone. Take the URL from the response, ignore only the favicon, and report
// anything else — so a genuinely missing asset is never silently swallowed.
const http4xx = [];
const unattributed = [];
page.on("response", (r) => { if (r.status() >= 400) http4xx.push(`${r.status()} ${r.url()}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  if (/favicon/i.test(text)) return;
  unattributed.push(text);
});

await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle2" });
await page.waitForFunction("() => !!window.__SETTINGS_PAGE__", { timeout: 30000 });
await sleep(1500);

report.nav = await page.evaluate("window.__SETTINGS_PAGE__.nav()");
if (JSON.stringify(report.nav) !== JSON.stringify(SECTIONS)) {
  report.problems.push(fail(`nav differs.\n    got:      ${JSON.stringify(report.nav)}\n    expected: ${JSON.stringify(SECTIONS)}`));
}

for (const label of SECTIONS) {
  const ok = await page.evaluate(`window.__SETTINGS_PAGE__.select(${JSON.stringify(label)})`);
  if (!ok) { report.problems.push(fail(`could not select section "${label}"`)); continue; }
  await sleep(1800);

  const panel = await page.evaluate("window.__SETTINGS_PAGE__.panel()");
  report.sections[label] = {
    headings: panel.headings,
    buttons: panel.buttons,
    inputCount: panel.inputs,
    textLength: String(panel.text).length,
    text: String(panel.text).slice(0, 1200),
  };

  if (panel.headings.length === 0) {
    report.problems.push(fail(`section "${label}" rendered no headings — it may have failed to mount`));
  }

  const text = String(panel.text);

  // Stray JSX punctuation and render artefacts. A ternary whose branch was edited out can
  // leave its `) : (` behind as literal TEXT — it renders as "):(" on screen, and no type
  // check or lint catches it because it is a perfectly valid string child. This class of bug
  // shipped once; the assertion exists so it cannot ship again.
  const STRAY = /\)\s*:\s*\(|\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/;
  const stray = text.match(STRAY);
  if (stray) {
    const at = text.indexOf(stray[0]);
    report.problems.push(fail(
      `"${label}" renders stray text ${JSON.stringify(stray[0])} — ` +
      `context: …${text.slice(Math.max(0, at - 60), at + 60)}…`,
    ));
  }

  if (label === "Integrations" && /Models Provider/.test(text)) {
    report.problems.push(fail("Models Provider is still under Integrations — it should have moved to AI service"));
  }

  if (label === "AI service") {
    // The section now owns provider + credentials + model detection + retrieval, with one
    // Save. These assertions pin each of those, because the previous version of this section
    // could not store an API key at all.
    // v1.7.1 — the provider card is now titled "Provider & credentials" (key lives with it).
    for (const need of ["Provider & credentials", "Model", "Retrieval & answer behaviour"]) {
      if (!panel.headings.includes(need)) {
        report.problems.push(fail(`AI service is missing the "${need}" card`));
      }
    }
    for (const need of ["Save AI settings", "Test connection", "Replace", "Re-detect"]) {
      if (!panel.buttons.includes(need)) {
        report.problems.push(fail(`AI service is missing the "${need}" control`));
      }
    }
    for (const need of ["API key", "Write-only", "Confidence threshold", "Top K results", "AI provider"]) {
      if (!text.includes(need)) {
        report.problems.push(fail(`AI service text is missing "${need}"`));
      }
    }
    // Auto-detection must have run off the stored key without a click.
    if (!/4 models detected/.test(text)) {
      report.problems.push(fail(`AI service did not auto-detect models (no "4 models detected" in the text)`));
    }
    const reqs = await page.evaluate("window.__SETTINGS_PAGE_REQS__");
    for (const path of ["/api/settings/integrations/llm/models", "/api/settings/integrations/llm", "/api/runtime"]) {
      if (!reqs.some((r) => r.includes(path))) {
        report.problems.push(fail(`AI service never requested ${path}`));
      }
    }
    report.aiServiceRequests = reqs.filter((r) => /integrations\/llm|runtime/.test(r));

    // Alignment is arithmetic, not a matter of opinion: every top-level block must share
    // the same left and right edge (1px tolerance for subpixel rounding).
    const blocks = await page.evaluate("window.__SETTINGS_PAGE__.blocks()");
    report.aiServiceBlocks = blocks;
    if (blocks.length < 3) {
      report.problems.push(fail(`AI service rendered only ${blocks.length} top-level blocks`));
    } else {
      const lefts = new Set(blocks.map((b) => b.left));
      const rights = new Set(blocks.map((b) => b.right));
      const widths = new Set(blocks.map((b) => b.width));
      if (lefts.size > 1) report.problems.push(fail(`AI service blocks do not share a left edge: ${[...lefts].join(", ")}`));
      if (rights.size > 1) report.problems.push(fail(`AI service blocks do not share a right edge: ${[...rights].join(", ")}`));
      if (widths.size > 1) report.problems.push(fail(`AI service blocks differ in width: ${[...widths].join(", ")}`));
      if (blocks.some((b) => b.height < 40)) {
        report.problems.push(fail(`AI service has a collapsed block: ${JSON.stringify(blocks.map((b) => b.height))}`));
      }
    }
  }

  const file = `${OUT}/settings_page_${label.toLowerCase().replace(/ /g, "_")}.png`;
  await page.screenshot({ path: file, fullPage: true });
  report.sections[label].screenshot = file;
}

report.requests = await page.evaluate("window.__SETTINGS_PAGE_REQS__");

// ---- design tokens (Linear/Vercel retune) ----------------------------------------
// Assert the RESOLVED values, not the source: a palette edit that is overridden by a later
// rule in the same stylesheet looks correct in the file and has no effect on screen. This
// is exactly what happened here — the file defined the theme twice and the second block won.
const tk = await page.evaluate("window.__SETTINGS_PAGE__.tokens()");
report.tokens = tk;
const EXPECT = {
  background: "#F7F8FC",
  primary: "#7C3AED",   // v1.7.0 — violet workspace primary (was the old blue ramp)
  border: "#DDE2EC",
  mutedForeground: "#5A6478",
  slate400Text: "rgb(138, 148, 171)",     // #8A94AB — navy ramp, matches the mockup
  slate800Border: "rgb(42, 47, 66)",       // #2A2F42
  roundedLg: "8px",                       // tightened from 12px
  roundedXl: "10px",                      // tightened from 14px
};
for (const [k, want] of Object.entries(EXPECT)) {
  const got = (tk[k] ?? "").toLowerCase();
  if (got !== want.toLowerCase()) {
    report.problems.push(fail(`token ${k} resolved to ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`));
  }
}
// The navy cast must be gone from the resolved utilities.
for (const [k, navy] of Object.entries({
  slate400Text: "rgb(117, 117, 121)",     // the superseded neutral value
  slate800Border: "rgb(35, 38, 43)",      // the superseded neutral value
})) {
  if ((tk[k] ?? "").toLowerCase() === navy) {
    report.problems.push(fail(`${k} still resolves to the old navy value ${navy}`));
  }
}
// Dark theme: the same stylesheet must also have moved off navy.
const darkTk = await page.evaluate(`(() => {
  document.documentElement.setAttribute("data-theme", "dark");
  return window.__SETTINGS_PAGE__.tokens();
})()`);
report.darkTokens = darkTk;
const DARK_EXPECT = {
  background: "#14121B",   // v1.5.0 charcoal-navy dark palette
  primary: "#8B5CF6",
  border: "#342C46",
  mutedForeground: "#9C93B4",
  card: "#1E1A2A",                        // plum card, lifted off the canvas
};
for (const [k, want] of Object.entries(DARK_EXPECT)) {
  const got = (darkTk[k] ?? "").toLowerCase();
  if (got !== want.toLowerCase()) {
    report.problems.push(fail(`dark token ${k} resolved to ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`));
  }
}

const ov = await page.evaluate("window.__SETTINGS_PAGE__.overflow()");
if (ov.scrollW > ov.clientW + 1) {
  report.problems.push(fail(`horizontal overflow: ${ov.scrollW} > ${ov.clientW}`));
}
report.jsErrors = jsErrors.slice(0, 5);
report.http4xx = http4xx;
report.ignoredFavicon = http4xx.filter((x) => /favicon\.ico/.test(x));
report.unattributedResourceErrors = http4xx.filter((x) => !/favicon\.ico/.test(x));
report.unattributedConsoleErrors = unattributed;
if (jsErrors.length) report.problems.push(fail(`${jsErrors.length} JS error(s): ${jsErrors.slice(0, 2).join(" | ")}`));
if (report.unattributedResourceErrors.length) {
  report.problems.push(fail(`unexpected failed resource(s): ${report.unattributedResourceErrors.join(", ")}`));
}

await browser.close();
dev.kill();

console.log(JSON.stringify(report, null, 2));
if (report.problems.length) {
  console.error(`\nFAILED (${report.problems.length}):`);
  for (const p of report.problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`\nOK: all ${SECTIONS.length} Settings sections rendered and were captured.`);
