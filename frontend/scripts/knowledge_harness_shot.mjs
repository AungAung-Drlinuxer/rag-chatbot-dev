// Screenshot + DRIVE the Knowledge page: proves the pager and the server-side list agree.
//
// The page is behind auth, so this renders the real component with `fetch` stubbed to the
// exact `/api/articles-list` contract (filter → sort → slice → `total`). 47 fixture rows
// give the pager several pages to walk.
//
// Asserted, not eyeballed:
//   1. first page shows 10 rows and "Showing 1–10 of 47"
//   2. Next requests offset=10&limit=10, re-renders rows, and marks page 2 current
//   3. the last page ends exactly at the total and disables Next (no page past the end)
//   4. page numbers are a window (1 … n), current marked aria-current=page, and clicking
//      one requests the offset that page actually starts at
//   5. rows-per-page sends the NEW limit and restarts at offset 0 (stale-closure bug)
//   6. sorting re-requests with the new sort/order and returns to page 1
//   7. a relevance search hides the pager (its hits are not a KB slice) and offers Clear
//   8. no JS error, no horizontal overflow at 1440 or 390; the error scenario shows an
//      error rather than an empty KB
//
// Usage (dev server only): node scripts/knowledge_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5229; // 5217/5219/5221/5223/5225/5227 are taken by the other harnesses
const BASE = `http://localhost:${PORT}/knowledge-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "pipe" });
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});
const reachable = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const problems = [];
const fail = (m) => problems.push(m);
const report = {};

const MEASURE = () => {
  const footer = [...document.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => /^Showing/.test(t.trim())) ?? null;
  const nav = document.querySelector('nav[aria-label="Pagination"]');
  const buttons = nav ? [...nav.querySelectorAll("button")] : [];
  return {
    vw: window.innerWidth,
    rows: document.querySelectorAll("tbody tr").length,
    firstRow: document.querySelector("tbody tr td button")?.textContent?.trim() ?? null,
    footer: footer?.replace(/\s+/g, " ").trim() ?? null,
    pageButtons: buttons
      .map((b) => ({ label: b.getAttribute("aria-label"), current: b.getAttribute("aria-current") === "page", disabled: b.disabled }))
      .filter((b) => b.label?.startsWith("Page ")),
    prevDisabled: buttons.find((b) => b.getAttribute("aria-label") === "Previous page")?.disabled ?? null,
    nextDisabled: buttons.find((b) => b.getAttribute("aria-label") === "Next page")?.disabled ?? null,
    pagerVisible: !!nav,
    searchFooter: /best match/.test(document.body.textContent ?? ""),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    // Layout facts for the narrow viewport: the search row must STACK below `sm`, and the
    // table must drop Source/Last-sync rather than force a horizontal scroll.
    formDir: (() => { const f = document.querySelector("form"); return f ? getComputedStyle(f).flexDirection : null; })(),
    searchStacked: (() => {
      const input = document.querySelector('input[aria-label="Search the knowledge base"]');
      const btn = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Search");
      if (!input || !btn) return null;
      return Math.round(btn.getBoundingClientRect().top) > Math.round(input.getBoundingClientRect().bottom) - 4;
    })(),
    visibleHeaders: Array.from(document.querySelectorAll("thead th")).filter((th) => th.offsetParent !== null).map((th) => th.textContent?.trim()),
  };
};

const listCalls = (page) => page.evaluate(() => (window.__KB_HARNESS__?.calls ?? []).filter((u) => /articles-list/.test(u)));
const clickLabel = async (page, label) => {
  await page.evaluate((l) => {
    [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === l)?.click();
  }, label);
  await sleep(900);
};

async function open(query = "") {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction("window.__KB_HARNESS__?.ready === true", { timeout: 20000 });
  await sleep(1100);
  return { page, errs };
}

// ---- 1. pager walk at 10/page -----------------------------------------------------
{
  const { page, errs } = await open();
  const p = [];
  const first = await page.evaluate(MEASURE);
  if (errs.length) p.push(`JS error: ${errs[0]}`);
  if (first.overflow) p.push("horizontal overflow at 1440");
  if (first.rows !== 10) p.push(`first page rendered ${first.rows} rows, expected 10`);
  if (first.footer !== "Showing 1–10 of 47") p.push(`first-page range was ${JSON.stringify(first.footer)}`);
  const firstReq = (await listCalls(page)).at(-1) ?? "";
  if (!/offset=0/.test(firstReq) || !/limit=10/.test(firstReq)) p.push(`first request wrong: ${firstReq}`);
  if (!first.pageButtons.some((b) => b.current && b.label === "Page 1")) p.push("page 1 not marked current");
  if (first.prevDisabled !== true) p.push("Previous enabled on page 1");

  await clickLabel(page, "Next page");
  const second = await page.evaluate(MEASURE);
  const secondReq = (await listCalls(page)).at(-1) ?? "";
  if (!/offset=10/.test(secondReq)) p.push(`Next did not request offset=10: ${secondReq}`);
  if (second.footer !== "Showing 11–20 of 47") p.push(`page-2 range was ${JSON.stringify(second.footer)}`);
  if (!second.pageButtons.some((b) => b.current && b.label === "Page 2")) p.push("page 2 not marked current");
  if (second.firstRow === first.firstRow) p.push("rows did not change between pages");

  await clickLabel(page, "Page 5");
  const last = await page.evaluate(MEASURE);
  const lastReq = (await listCalls(page)).at(-1) ?? "";
  if (!/offset=40/.test(lastReq)) p.push(`Page 5 requested ${lastReq}, expected offset=40`);
  if (last.footer !== "Showing 41–47 of 47") p.push(`last-page range was ${JSON.stringify(last.footer)}`);
  if (last.rows !== 7) p.push(`last page rendered ${last.rows} rows, expected 7`);
  if (last.nextDisabled !== true) p.push("Next enabled on the last page");

  const labels = last.pageButtons.map((b) => b.label);
  if (labels.length > 7) p.push(`pager rendered ${labels.length} number buttons`);
  if (!labels.includes("Page 1") || !labels.includes("Page 5")) p.push(`pager missing first/last: ${labels.join(",")}`);

  await page.screenshot({ path: `${OUT}/knowledge_pager_last.png`, fullPage: true });
  report.pager = { first, second, last, firstReq, secondReq, lastReq, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 2. rows-per-page + sorting ---------------------------------------------------
{
  const { page } = await open();
  const p = [];

  await page.select('select[aria-label="Rows per page"]', "25");
  await sleep(1000);
  const afterSize = await page.evaluate(MEASURE);
  const sizeReq = (await listCalls(page)).at(-1) ?? "";
  if (!/limit=25/.test(sizeReq)) p.push(`rows-per-page sent ${sizeReq} (expected limit=25)`);
  if (!/offset=0/.test(sizeReq)) p.push(`rows-per-page kept the old offset: ${sizeReq}`);
  if (afterSize.footer !== "Showing 1–25 of 47") p.push(`25/page range was ${JSON.stringify(afterSize.footer)}`);
  if (afterSize.rows !== 25) p.push(`25/page rendered ${afterSize.rows} rows`);

  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === "Sort by Article title")?.click();
  });
  await sleep(1000);
  const sortReq = (await listCalls(page)).at(-1) ?? "";
  if (!/sort=title/.test(sortReq)) p.push(`sort click sent ${sortReq}`);
  if (!/order=(asc|desc)/.test(sortReq)) p.push(`sort click omitted order: ${sortReq}`);
  if (!/offset=0/.test(sortReq)) p.push(`sort did not return to page 1: ${sortReq}`);

  await page.screenshot({ path: `${OUT}/knowledge_pager_25.png`, fullPage: true });
  report.size_sort = { sizeReq, afterSize, sortReq, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 3. relevance search hides the pager -------------------------------------------
{
  const { page } = await open();
  await page.type('input[aria-label="Search the knowledge base"]', "vpn");
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === "Search")?.click();
  });
  await sleep(1300);
  const m = await page.evaluate(MEASURE);
  const body = await page.evaluate(() => document.body.textContent ?? "");
  const p = [];
  if (m.pagerVisible) p.push("pager still shown during relevance search");
  if (!m.searchFooter) p.push("no match-count footer during relevance search");
  if (!/Clear search/.test(body)) p.push("no Clear search action");
  await page.screenshot({ path: `${OUT}/knowledge_search.png`, fullPage: true });
  report.search = { ...m, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 4. mobile + dark + error ------------------------------------------------------
{
  for (const [name, query, vp] of [
    ["mobile", "?theme=light", { width: 390, height: 844 }],
    ["dark", "?theme=dark", { width: 1440, height: 1000 }],
    ["error", "?scenario=error", { width: 1440, height: 1000 }],
  ]) {
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await page.setViewport({ ...vp, deviceScaleFactor: 2 });
    await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction("window.__KB_HARNESS__?.ready === true", { timeout: 20000 });
    await sleep(1200);
    const m = await page.evaluate(MEASURE);
    const body = await page.evaluate(() => document.body.textContent ?? "");
    const p = [];
    if (m.overflow) p.push(`${name}: horizontal overflow`);
    if (name === "mobile") {
      if (m.formDir !== "column") p.push(`mobile: search row is ${m.formDir}, expected a stacked column`);
      if (m.searchStacked !== true) p.push("mobile: Search button is not below the input");
      const heads = (m.visibleHeaders ?? []).join("|");
      if (/Source|Last sync/.test(heads)) p.push(`mobile: table still shows ${heads}`);
      if (m.rows !== 10) p.push(`mobile: rendered ${m.rows} rows`);
    }
    if (name === "error" && !/Could not load the knowledge base/.test(body)) p.push("error: missing error state");
    if (name === "error" && /No articles yet/.test(body)) p.push("error: rendered an empty state instead");
    await page.screenshot({ path: `${OUT}/knowledge_${name}.png`, fullPage: true });
    report[name] = { ...m, body: body.slice(0, 500), errs, problems: p };
    p.forEach(fail);
    await page.close();
  }
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (problems.length) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: pager matches the server (range, offsets, window, limits), search is not paged, no overflow");
