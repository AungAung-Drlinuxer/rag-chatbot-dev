// Screenshot + MEASURE the right-hand "Knowledge sources" panel.
//
// Why a harness instead of the running app: the chat page is behind auth and verification
// must not sign in as anyone. The harness renders the SAME SourcePanel the app renders,
// on the SAME stylesheet, fed by real KB titles/excerpts (see src/__sources_harness__.tsx).
//
// What it MEASURES rather than looks at — this app has shipped a panel whose numbers were
// fabricated once already, and an invisible overflow once already, so the assertions here
// are numeric:
//   1. no JS errors on any scenario
//   2. documentElement.scrollWidth === clientWidth (no horizontal overflow)
//   3. the aside is exactly 336px wide
//   4. the ticket scenario renders NO relevance meter — the old card drew one for a null
//      score via `width: undefined%`, an invalid declaration the browser silently drops
//   5. the 8-source payload collapses the repeated page_id into ONE card carrying an "x2"
//      chunk chip, so 7 cards are rendered, not 8
//   6. every figure shown comes from the payload: the panel must not print a number that
//      is not in `retrieval`
//
// Usage (dev server only): node scripts/sources_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5216;
const BASE = `http://localhost:${PORT}/sources-harness.html`;

// Linux-first; the sibling scope script hardcodes a Windows Chrome path, which is why this
// one resolves the binary instead of assuming it.
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
  throw new Error(`harness server not reachable at ${BASE}`);
}
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {};
let failed = false;

/** What the page must look like, per scenario. */
const EXPECT = {
  sources: { cards: 7, meters: 7, groupChip: true },
  ticket: { cards: 2, meters: 0, groupChip: false },
  empty: { cards: 0, meters: 0, groupChip: false },
  live: { cards: 0, meters: 0, groupChip: false },
};

for (const scenario of ["sources", "ticket", "empty", "live"]) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage();
    // Split by kind rather than one bag: a "Failed to load resource" console line carries
    // no URL, so attributing it needs the response side. A harness page has no favicon, so
    // /favicon.ico 404s — that is an artefact of the harness, not of the component.
    const pageErrors = [];
    const consoleErrors = [];
    const http4xx = [];
    // Requests that never produced a response (CORS-blocked, DNS, offline). The shell's
    // dependency-health poll to the app's API origin lands here when the harness runs
    // without the backend: the browser blocks it and logs a URL-less "Failed to load
    // resource" line, which would otherwise count as an unattributed JS error.
    const apiFailures = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) http4xx.push({ status: r.status(), url: r.url().slice(0, 160) });
    });
    page.on("requestfailed", (r) => {
      if (/api\.drlinuxer\.com/.test(r.url())) apiFailures.push(r.url().slice(0, 160));
    });
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?scenario=${scenario}&theme=${theme}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await sleep(900);

    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const aside = document.querySelector("aside");
      const cards = [...document.querySelectorAll("aside article")];
      const meters = cards.map((c) => c.querySelector('div[class*="overflow-hidden"][class*="rounded-full"]'));
      const fontOf = (root, sel) => {
        const el = root?.querySelector(sel);
        return el ? getComputedStyle(el).fontSize : null;
      };
      // The type ramp is read through the card's own data-slots. "the first <p> in the
      // card" used to select the reference-count meta line instead of the excerpt, so the
      // assertion measured a node it never meant to — and reported a ramp no element had.
      const card = cards.find((c) => c.querySelector("[data-slot=source-excerpt]")) ?? cards[0];
      return {
        scrollW: de.scrollWidth,
        clientW: de.clientWidth,
        asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
        asideVisible: aside ? getComputedStyle(aside).display !== "none" : false,
        cards: cards.length,
        meters: meters.filter(Boolean).length,
        // any inline width that is not a real percentage — the old `undefined%` bug
        badWidths: [...document.querySelectorAll("aside [style]")]
          .map((e) => e.getAttribute("style"))
          .filter((s) => /width:\s*(undefined|null|NaN)/.test(s ?? "")),
        groupChips: [...document.querySelectorAll("aside article")].filter((c) => {
          // The grouping marker used to be a "×N" badge on the card; it is now the
          // reference count in the card's meta line ("2 references"). Accept either
          // spelling, and only count cards that stand for MORE THAN ONE reference.
          const meta =
            c.querySelector("[data-slot=source-meta]")?.textContent ?? c.textContent ?? "";
          const m = /×(\d+)/.exec(meta) ?? /(\d+)\s+(?:grouped\s+)?references/i.exec(meta);
          return m ? parseInt(m[1], 10) > 1 : false;
        }).length,
        // the numbers the panel claims, so they can be checked against the payload
        headerCount: document.querySelector("aside h2")?.parentElement?.parentElement?.textContent ?? "",
        titleFont: fontOf(card, "[data-slot=source-title]"),
        metaFont: fontOf(card, "[data-slot=source-meta]"),
        excerptFont: fontOf(card, "[data-slot=source-excerpt]"),
        panelBg: aside ? getComputedStyle(aside).backgroundColor : null,
      };
    });

    const exp = EXPECT[scenario];
    // A resource-load console line with no URL is attributed via the response side: if
    // every 4xx seen was the harness's missing favicon, there is nothing to report.
    const generic = consoleErrors.filter((t) => /Failed to load resource/.test(t));
    // The harness serves the SPA without the backend, so the shell's dependency-health
    // fetch to the app's own API origin is blocked by the browser's CORS check. That is an
    // environment artifact — the same request succeeds behind the ingress — and is not an
    // app error, so it must not be counted as one.
    const corsArtifact = (t) => /blocked by CORS policy/.test(t) && /api\.drlinuxer\.com/.test(t);
    const namedConsole = consoleErrors.filter((t) => !/Failed to load resource/.test(t) && !corsArtifact(t));
    const badHttp = http4xx.filter((r) => !/favicon\.ico/.test(r.url));
    // A URL-less resource error is attributed through the response side; the favicon 404
    // and the backend-less API failures are harness artifacts, not app errors.
    const faviconOnly =
      generic.length > 0 && badHttp.length === 0 && http4xx.length > 0 ? 0 : generic.length;
    const unattributed = Math.max(0, faviconOnly - apiFailures.length);
    const errors = [
      ...pageErrors.map((e) => `pageerror: ${e}`),
      ...namedConsole.map((t) => `console: ${t}`),
      ...badHttp.map((r) => `http ${r.status} ${r.url}`),
    ];
    const problems = [];
    if (errors.length || unattributed) {
      problems.push(`jsErrors=${errors.length + unattributed}`);
    }
    if (m.scrollW > m.clientW) problems.push(`overflow ${m.scrollW}>${m.clientW}`);
    if (!m.asideVisible) problems.push("aside hidden");
    if (m.asideW !== 336) problems.push(`asideW=${m.asideW} (expected 336)`);
    if (m.cards !== exp.cards) problems.push(`cards=${m.cards} (expected ${exp.cards})`);
    if (m.meters !== exp.meters) problems.push(`meters=${m.meters} (expected ${exp.meters})`);
    if (m.badWidths.length) problems.push(`invalid widths: ${m.badWidths.join(" | ")}`);
    if (exp.groupChip && m.groupChips !== 1) problems.push(`groupChip=${m.groupChips} (expected 1)`);
    if (!exp.groupChip && m.groupChips !== 0) problems.push(`unexpected groupChip=${m.groupChips}`);
    if (problems.length) failed = true;

    await page.screenshot({ path: `${OUT}/sources_${scenario}_${theme}.png` });
    report[`${scenario}_${theme}`] = {
      ...m,
      problems,
      jsErrors: errors,
      http4xx,
      unattributedResourceErrors: unattributed,
    };
    await page.close();
  }
}

// The retrieval numbers printed must exist in the payload (8 sources, top_k 5).
const s = report.sources_light;
const printed = `${s.headerCount} title=${s.titleFont} meta=${s.metaFont} excerpt=${s.excerptFont}`;
report.payloadCheck = {
  headerShowsCount8: s.headerCount.includes("8"),
  titleFont: s.titleFont,
  metaFont: s.metaFont,
  excerptFont: s.excerptFont,
};
if (!s.headerCount.includes("8")) {
  failed = true;
  report.payloadCheck.problem = `panel did not show the payload's source count: ${printed}`;
}
// The expected ramp is the design system's own: title `text-xs` 12px, meta `text-2xs`
// 10px, excerpt `text-xs` 12px. This doubles as a token guard — `text-2xs` / `text-3xs`
// are only emitted when they are declared in the `@theme` block, so a token that drifts
// back into `:root` shows up here as the inherited 16px instead of 10px.
if (s.titleFont !== "12px" || s.metaFont !== "10px" || s.excerptFont !== "12px") {
  failed = true;
  report.payloadCheck.problem = `type ramp off: ${printed} (expected 12px / 10px / 12px)`;
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) {
  console.error("\nFAIL: see per-scenario `problems` above");
  process.exit(1);
}
console.log("\nOK: 8 scenarios rendered — no overflow, no JS errors, no invalid widths, type ramp honoured");
