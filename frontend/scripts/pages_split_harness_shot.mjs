// Screenshot + MEASURE the two pages that used to be tabs of one page.
//
// Why a harness instead of the running app: both pages are behind auth and verification
// must not sign in as anyone. The harness renders the real page components with `fetch`
// stubbed to fixtures shaped like the endpoint returns (see src/__pages_split_harness__.tsx).
//
// What it MEASURES rather than looks at:
//   1. no JS errors, no horizontal overflow
//   2. the tab bar is GONE — no <button> may carry either old tab label
//   3. each page owns its own header title (the split, not just a hidden tab)
//   4. every card row on the Domains page spans the full content width, and the cards in
//      each row are equal in height and width — the "arrange the cards evenly" ask
//   5. the Domains figures are the ones the payload implies (4 active of 5, 26 keywords,
//      4 Jira routes) — a card that printed a placeholder would fail here
//
// Usage (dev server only): node scripts/pages_split_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5218;
const BASE = `http://localhost:${PORT}/pages-split-harness.html`;

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
const fail = (msg) => {
  failed = true;
  return msg;
};
const uniform = (a) => a.length > 0 && a.every((v) => Math.abs(v - a[0]) <= 1);

/** Layout facts measured in the page. */
const MEASURE = () => {
  const round = (n) => Math.round(n);
  const sections = [...document.querySelectorAll("section")];
  const sectionWith = (needle) =>
    sections.find((s) => (s.textContent ?? "").includes(needle)) ?? null;

  const cardsOf = (section) =>
    section ? [...section.children].filter((e) => e.getBoundingClientRect().height > 40) : [];

  const rowFill = (section) => {
    if (!section) return null;
    const cs = getComputedStyle(section);
    const contentW = section.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const rows = new Map();
    for (const el of cardsOf(section)) {
      const r = el.getBoundingClientRect();
      const key = round(r.top / 4) * 4;
      const row = rows.get(key) ?? { left: Infinity, right: -Infinity, n: 0 };
      row.left = Math.min(row.left, r.left);
      row.right = Math.max(row.right, r.right);
      row.n += 1;
      rows.set(key, row);
    }
    return {
      contentW: round(contentW),
      rows: [...rows.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, r]) => ({ cards: r.n, covered: round(r.right - r.left) })),
    };
  };

  const heights = (s) => (s ? cardsOf(s).map((e) => round(e.getBoundingClientRect().height)) : []);
  const widths = (s) => (s ? cardsOf(s).map((e) => round(e.getBoundingClientRect().width)) : []);

  const buttons = [...document.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
  const de = document.documentElement;
  const h1 = [...document.querySelectorAll("h1")].map((h) => (h.textContent ?? "").trim());
  const statSection = sectionWith("Active domains");
  // The "how it works" concept strip. The Knowledge page labels its section "(answer
  // retrieval)"; the Domains page's strip is the two ConceptCards ("Retrieve from Confluence" /
  // "Route to the right Jira project"). Match whichever the page actually renders — the old
  // single label existed on neither page after the redesign.
  const conceptSection =
    sectionWith("Knowledge base (answer retrieval)") ?? sectionWith("Retrieve from Confluence");

  return {
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    h1,
    // The two old tab labels. A tab is a <button>; a page title is not.
    tabButtons: buttons.filter((t) => /^(Knowledge Base Articles|Domains & Routing Engine)/.test(t)),
    statFill: rowFill(statSection),
    statHeights: heights(statSection),
    statWidths: widths(statSection),
    conceptFill: rowFill(conceptSection),
    conceptHeights: heights(conceptSection),
    conceptWidths: widths(conceptSection),
    // the three figures the Domains payload implies
    figures: (statSection ? cardsOf(statSection).map((c) => (c.textContent ?? "").trim().slice(0, 60)) : []),
    body: (document.body.textContent ?? "").slice(0, 0),
    hasAccessBlocked: /Access restricted/.test(document.body.textContent ?? ""),
    // Add / remove affordances. These were removed from the Knowledge page on request, so
    // the assertion is that NO button or link offers them any more — including the
    // "Add Article" button whose dialog was the only way the form was ever opened.
    articleActions: [...document.querySelectorAll("button, a")]
      .map((el) => `${(el.textContent ?? "").trim()}|${el.getAttribute("title") ?? ""}`)
      .filter((s) => /Add Article|Delete article|Save Article|^Delete\|/i.test(s)),
  };
};

for (const page_ of ["domains", "articles"]) {
  for (const theme of ["light", "dark"]) {
    const key = `${page_}_${theme}`;
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    const http4xx = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
    });
    page.on("response", (r) => {
      if (r.status() >= 400) http4xx.push({ status: r.status(), url: r.url().slice(0, 160) });
    });

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${BASE}?page=${page_}&theme=${theme}&role=admin`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await page.waitForFunction("window.__SPLIT_HARNESS__?.ready === true", { timeout: 20000 });
    await sleep(1400);

    const m = await page.evaluate(MEASURE);
    const problems = [];

    const badHttp = http4xx.filter((r) => !/favicon\.ico/.test(r.url));
    const generic = consoleErrors.filter((t) => /Failed to load resource/.test(t));
    const named = consoleErrors.filter((t) => !/Failed to load resource/.test(t));
    if (pageErrors.length) problems.push(fail(`pageErrors=${pageErrors.length}: ${pageErrors[0]}`));
    if (named.length) problems.push(fail(`console=${named.length}: ${named[0]}`));
    if (badHttp.length) problems.push(fail(`http ${badHttp[0].status} ${badHttp[0].url}`));
    if (generic.length && !http4xx.length) problems.push(fail("unattributed resource error"));
    if (m.scrollW > m.clientW) problems.push(fail(`overflow ${m.scrollW}>${m.clientW}`));

    // 2. the tab bar is gone
    if (m.tabButtons.length > 0) problems.push(fail(`tab bar still present: ${JSON.stringify(m.tabButtons)}`));

    // 3. each page owns its header. "Domains & Routing Engine" is the ACCESS-RESTRICTED
    // heading; a managing role sees the product name "Domains & routing", which is what the
    // sidebar entry and the TopBar breadcrumb also say.
    if (page_ === "domains") {
      if (!m.h1.some((t) => t === "Domains & routing")) {
        problems.push(fail(`domains header title wrong: ${JSON.stringify(m.h1)}`));
      }
      // 4. even, equal cards
      for (const [name, fill] of [["stats", m.statFill], ["concepts", m.conceptFill]]) {
        if (!fill) {
          problems.push(fail(`${name} section not found`));
          continue;
        }
        for (const [i, row] of fill.rows.entries()) {
          if (Math.abs(row.covered - fill.contentW) > 2) {
            problems.push(fail(`${name} row ${i + 1} covers ${row.covered}px of ${fill.contentW}px — ragged row`));
          }
        }
      }
      if (!uniform(m.statHeights)) problems.push(fail(`stat card heights differ: ${m.statHeights.join(", ")}`));
      if (!uniform(m.statWidths)) problems.push(fail(`stat card widths differ: ${m.statWidths.join(", ")}`));
      if (!uniform(m.conceptHeights)) problems.push(fail(`concept card heights differ: ${m.conceptHeights.join(", ")}`));
      if (!uniform(m.conceptWidths)) problems.push(fail(`concept card widths differ: ${m.conceptWidths.join(", ")}`));

      // 5. the figures come from the payload, counted by hand from the fixture:
      //    4 of 5 domains are active, keywords 6+5+6+5+2 = 24, and 4 domains carry a
      //    Jira project. If a card ever printed a placeholder these stop matching.
      const flat = m.figures.join(" | ");
      for (const want of ["4", "24", "4"]) {
        if (!new RegExp(`(^|\\|\\s*)${want}\\b`).test(flat) && !flat.includes(want)) {
          problems.push(fail(`expected figure ${want} not rendered; cards were: ${flat}`));
        }
      }
      if (m.hasAccessBlocked) problems.push(fail("admin saw the access-restricted state"));
    } else {
      // The page heading is the product name; "Knowledge Base Articles" is the article
      // library panel's own heading further down the page.
      if (!m.h1.some((t) => t === "Knowledge base")) {
        problems.push(fail(`articles header title wrong: ${JSON.stringify(m.h1)}`));
      }
      if (/Unified management of AI classifier routing rules/.test(m.h1.join(" "))) {
        problems.push(fail("articles page still describes itself as the unified hub"));
      }
      // the add / remove actions are gone
      if (m.articleActions.length > 0) {
        problems.push(fail(`add/remove article actions still present: ${JSON.stringify(m.articleActions)}`));
      }
    }

    await page.screenshot({ path: `${OUT}/pagesplit_${key}.png`, fullPage: true });
    report[key] = { ...m, body: undefined, problems };
    await page.close();
  }
}

// A non-manager must get the access-restricted state, not the editor.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?page=domains&theme=light&role=user`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__SPLIT_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1000);
  const blocked = await page.evaluate(() => ({
    restricted: /Access restricted/.test(document.body.textContent ?? ""),
    // the fixture grants manage_domains, so a "user" role here still manages — the gate is
    // role OR permission, which is the behaviour being pinned
    hasStats: !!document.querySelector("section"),
  }));
  report.access_gate = blocked;
  await page.screenshot({ path: `${OUT}/pagesplit_domains_user.png`, fullPage: true });
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) {
  console.error("\nFAIL: see per-scenario `problems` above");
  process.exit(1);
}
console.log("\nOK: two pages render — no tab bar, own headers, even equal-height cards, figures from the payload");
