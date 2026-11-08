// Screenshot + MEASURE the shell-level top bar by booting the REAL App.
//
// Why a harness instead of the running app: every page is behind auth and verification must
// not sign in as anyone. src/__topbar_harness__.tsx mounts the real <App /> with a session
// restored from sessionStorage and `fetch` stubbed to fixtures shaped like the endpoint
// returns (see that file). The top bar is SHELL-level, so it cannot be seen by rendering a
// single page component the way the other harnesses do.
//
// What it MEASURES rather than looks at, for every non-chat nav id:
//   1. the top bar exists, is 48px tall, and no JS errors were thrown
//   2. its breadcrumb reads the page's exact trail ("Workspace / <Page>")
//   3. the breadcrumb appears exactly ONCE on the page — the duplicate <PageHeader> nav is gone
//   4. the health pill reads "7 dependencies healthy in source" (7 healthy services in the fixture)
// and for the chat route:
//   5. there is NO top bar (the chat page keeps its own header)
//
// Usage (dev server only): node scripts/topbar_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5243; // 5214–5242 are taken by the other harnesses
const BASE = `http://localhost:${PORT}/topbar-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error(`harness not reachable at ${BASE}`);
}
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const EXPECT = {
  dashboard: "Workspace/Overview",
  articles: "Workspace/Knowledge",
  tickets: "Workspace/Support",
  domains: "Workspace/Domains & routing",
  users: "Workspace/Users",
  history: "Workspace/Conversations",
  audits: "Workspace/Audit log",
  settings: "Workspace/Settings",
};
const NAVS = Object.keys(EXPECT);
const PILL = "7 dependencies healthy in source";

const report = { problems: [], scenarios: {} };
const fail = (m) => m;

/** Layout/text facts, read from the live DOM. */
const MEASURE = () => {
  const bar = document.querySelector('[data-slot="topbar"]');
  const pill = document.querySelector('[data-slot="health-pill"]');
  const crumbNavs = [...document.querySelectorAll('nav[aria-label="Breadcrumb"]')];
  const crumb = crumbNavs[0];
  const de = document.documentElement;
  return {
    hasTopBar: !!bar,
    hasSidebar: !!document.querySelector("aside"),
    barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    barClass: bar ? bar.getAttribute("class") : null,
    barBg: bar ? getComputedStyle(bar).backgroundColor : null,
    breadcrumbCount: crumbNavs.length,
    breadcrumb: crumb ? (crumb.textContent ?? "").replace(/\s+/g, "") : null,
    pill: pill ? (pill.textContent ?? "").replace(/\s+/g, " ").trim() : null,
    overflow: de.scrollWidth > de.clientWidth,
    /* The shell's scroll area. A page that claims to fit one screen has to fit THIS box,
       which is the viewport minus the 48px top bar — not the viewport. */
    scrollAreaH: (() => {
      const el = document.querySelector('[data-slot="page-scroll"]');
      return el ? el.clientHeight : null;
    })(),
    scrollAreaScrollH: (() => {
      const el = document.querySelector('[data-slot="page-scroll"]');
      return el ? el.scrollHeight : null;
    })(),
  };
};

for (const theme of ["light", "dark"]) {
  for (const nav of NAVS) {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?theme=${theme}#/${nav}`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction("window.__TOPBAR_HARNESS__?.ready === true", { timeout: 20000 });
    await page.waitForFunction('!!document.querySelector(\'[data-slot="topbar"]\')', { timeout: 20000 });
    await page.waitForFunction('!!document.querySelector(\'[data-slot="health-pill"]\')', { timeout: 20000 });
    await sleep(600);

    const m = await page.evaluate(MEASURE);
    const problems = [];
    if (pageErrors.length) problems.push(fail(`pageErrors=${pageErrors.length}: ${pageErrors[0]}`));
    if (!m.hasTopBar) problems.push(fail("no top bar rendered on a non-chat page"));
    if (m.barHeight !== 48) problems.push(fail(`top bar height is ${m.barHeight}px, expected 48`));
    // MEASURE strips whitespace (the "/" separator is a flex gap, not text), so compare
    // against the expected trail with the same normalization applied.
    const wantCrumb = EXPECT[nav].replace(/\s+/g, "");
    if (m.breadcrumb !== wantCrumb) problems.push(fail(`breadcrumb is ${JSON.stringify(m.breadcrumb)}, expected ${JSON.stringify(wantCrumb)}`));
    if (m.breadcrumbCount !== 1) problems.push(fail(`breadcrumb nav rendered ${m.breadcrumbCount}x — expected exactly 1`));
    if (m.pill !== PILL) problems.push(fail(`pill is ${JSON.stringify(m.pill)}, expected ${JSON.stringify(PILL)}`));
    if (m.overflow) problems.push(fail("horizontal overflow"));
    // The dashboard must read in ONE screen. Inside the shell it gets 900 − 48 = 852px;
    // this is the assertion that catches a band growing past that again.
    if (nav === "dashboard" && m.scrollAreaScrollH > m.scrollAreaH + 1) {
      problems.push(fail(`dashboard scrolls inside the shell: ${m.scrollAreaScrollH} > ${m.scrollAreaH}`));
    }

    report.scenarios[`${nav}_${theme}`] = { ...m, pageErrors: pageErrors.length, problems };
    if (problems.length) report.problems.push(...problems.map((p) => `[${nav}_${theme}] ${p}`));
    await page.screenshot({ path: `${OUT}/topbar_${nav}_${theme}.png`, fullPage: false });
    await page.close();
  }
}

// The chat route must have NO top bar (it keeps its own column header).
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?theme=${theme}#/chat`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__TOPBAR_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1200);

  const m = await page.evaluate(MEASURE);
  const problems = [];
  // The sidebar proves the authenticated shell actually mounted — otherwise "no top bar"
  // would pass even if the whole app had crashed.
  if (!m.hasSidebar) problems.push(fail("authenticated shell did not mount (no sidebar)"));
  if (m.hasTopBar) problems.push(fail("chat page rendered a top bar — it must not"));
  if (m.breadcrumbCount !== 0) problems.push(fail(`chat page has ${m.breadcrumbCount} breadcrumb nav(s), expected 0`));

  report.scenarios[`chat_${theme}`] = { ...m, pageErrors: pageErrors.length, problems };
  if (problems.length) report.problems.push(...problems.map((p) => `[chat_${theme}] ${p}`));
  await page.screenshot({ path: `${OUT}/topbar_chat_${theme}.png`, fullPage: false });
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (report.problems.length) {
  console.log(`\nFAILED (${report.problems.length}):`);
  for (const p of report.problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`\nOK: top bar on all ${NAVS.length} non-chat pages (48px, breadcrumb once, pill "${PILL}"); none on chat.`);
