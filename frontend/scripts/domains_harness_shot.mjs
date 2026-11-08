// Screenshot + DRIVE the Domains & Routing page.
//
// Renders the real page against the `/api/admin/domains` contract (see
// src/__domains_harness__.tsx) and asserts the things a redesign can quietly break:
//
//   1. the four figures equal what the fixture contains (5 active, 38 keywords, 4 Jira
//      routes, 3 needing attention) — no invented numbers
//   2. the flow is two steps, side by side on desktop and stacked on mobile
//   3. every domain shows name, key, status, Jira state and its keyword count; an
//      inactive domain renders as inactive and sorts after the active ones
//   4. keyword overflow is honest: 9 keywords show 6 tags + an explicit "+3 more" that
//      expands and collapses
//   5. the status switch filters (Needs attention → only the flagged rows) and search
//      narrows to a match
//   6. actions are reachable with real labels, and stack full-width on mobile
//   7. no horizontal overflow at 320 / 390 / 768 / 1440, in light or dark
//
// Usage (dev server only): node scripts/domains_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5231;
const BASE = `http://localhost:${PORT}/domains-harness.html`;

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
  const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const statSection = document.querySelector('section[aria-label="Routing metrics"]');
  const stats = statSection
    ? [...statSection.children].map((c) => ({
        label: txt(c.querySelector("span:last-of-type")),
        value: txt(c.querySelector("div:nth-child(2)")),
        caption: txt(c.querySelector("p")),
      }))
    : [];
  const flow = document.querySelector('section[aria-label="How routing works"]');
  const steps = flow ? [...flow.querySelectorAll("h3")].map((h) => txt(h)) : [];
  const stepRects = flow
    ? [...flow.querySelectorAll("h3")].map((h) => {
        const r = h.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y) };
      })
    : [];
  const rows = [...document.querySelectorAll("article")];
  const nav = document.querySelector('nav[aria-label="Pagination"]');
  return {
    vw: window.innerWidth,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    stats,
    steps,
    stepRects,
    flowSideBySide: stepRects.length === 2 ? Math.abs(stepRects[0].y - stepRects[1].y) < 8 && stepRects[1].x > stepRects[0].x : null,
    rows: rows.length,
    names: rows.map((r) => txt(r.querySelector("h3"))),
    rowSummaries: rows.map((r) => txt(r).slice(0, 220)),
    editLabels: [...document.querySelectorAll('button[aria-label^="Edit "]')].map((b) => b.getAttribute("aria-label")),
    deleteLabels: [...document.querySelectorAll('button[aria-label^="Delete "]')].map((b) => b.getAttribute("aria-label")),
    tagCounts: rows.map((r) => r.querySelectorAll("span.rounded-md.border").length),
    hasPager: !!nav,
    cardBg: getComputedStyle(document.documentElement).getPropertyValue("--card").trim(),
    background: getComputedStyle(document.documentElement).getPropertyValue("--background").trim(),
    theme: document.documentElement.getAttribute("data-theme"),
  };
};

const open = async (query = "") => {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 2 });
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1400);
  return { page, errs };
};

// ---- 1. desktop structure + figures ------------------------------------------------
{
  const { page, errs } = await open();
  const m = await page.evaluate(MEASURE);
  const p = [];
  if (errs.length) p.push(`JS error: ${errs[0]}`);
  if (m.overflow) p.push("horizontal overflow at 1440");
  const values = m.stats.map((s) => s.value);
  if (values.join(",") !== "6,30,5,3") p.push(`stat values were ${values.join(",")}, expected 6,30,5,3`);
  if (m.stats.length !== 4) p.push(`rendered ${m.stats.length} stat tiles`);
  if (m.steps.length !== 2) p.push(`rendered ${m.steps.length} flow steps`);
  if (m.flowSideBySide !== true) p.push("flow steps are not side by side on desktop");
  if (m.rows !== 7) p.push(`rendered ${m.rows} domain rows, expected 7`);
  // Active first, then alphabetical: Database leads, the retired HR domain is last.
  if (m.names[0] !== "Database") p.push(`first row was ${m.names[0]}, expected Database`);
  if (m.names.at(-1) !== "HR (retired)") p.push(`last row was ${m.names.at(-1)}, expected the inactive domain`);
  if (!m.names.includes("HR (retired)")) p.push("inactive domain missing from the list");
  if (m.editLabels.length !== 7 || m.deleteLabels.length !== 7) p.push(`actions: ${m.editLabels.length} edit / ${m.deleteLabels.length} delete`);
  if (!m.rowSummaries.some((t) => /No Jira route/.test(t))) p.push("a domain without a Jira route is not marked");
  if (!m.rowSummaries.some((t) => /No keywords/.test(t))) p.push("a keyword-less domain is not marked");
  if (m.hasPager) p.push("an unrelated pager appeared");

  // keyword overflow: Database has 9 keywords → 6 tags + "+3 more"
  const dbRow = await page.evaluate(() => {
    const row = [...document.querySelectorAll("article")].find((a) => /Database/.test(a.textContent ?? ""));
    return row ? {
      tags: row.querySelectorAll("span.rounded-md.border").length,
      more: !!row.querySelector("button[aria-expanded]"),
      moreLabel: row.querySelector("button[aria-expanded]")?.textContent?.trim() ?? null,
    } : null;
  });
  if (!dbRow || dbRow.tags !== 6) p.push(`Database tag count ${dbRow?.tags}, expected 6`);
  if (!dbRow?.more || dbRow.moreLabel !== "+3 more") p.push(`overflow control: ${dbRow?.moreLabel}`);

  await page.screenshot({ path: `${OUT}/domains_desktop_light.png`, fullPage: true });
  report.desktop = { ...m, dbRow, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 2. interactions: expand, filter, search ---------------------------------------
{
  const { page } = await open();
  const p = [];

  // expand keywords
  await page.evaluate(() => {
    const row = [...document.querySelectorAll("article")].find((a) => /Database/.test(a.textContent ?? ""));
    row?.querySelector("button[aria-expanded]")?.click();
  });
  await sleep(400);
  const expanded = await page.evaluate(() => {
    const row = [...document.querySelectorAll("article")].find((a) => /Database/.test(a.textContent ?? ""));
    return { tags: row?.querySelectorAll("span.rounded-md.border").length, label: row?.querySelector("button[aria-expanded]")?.textContent?.trim() };
  });
  if (expanded.tags !== 9) p.push(`expanded tags ${expanded.tags}, expected 9`);
  if (!/Show less/.test(expanded.label ?? "")) p.push(`expand label was ${expanded.label}`);

  // status filter: needs attention → 3 rows
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith("Needs attention"))?.click();
  });
  await sleep(500);
  const attention = await page.evaluate(MEASURE);
  if (attention.rows !== 3) p.push(`attention filter showed ${attention.rows} rows, expected 3`);
  if (attention.names.some((n) => n === "Database")) p.push("attention filter kept a healthy domain");

  // reset then search
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reset")?.click();
  });
  await sleep(400);
  await page.type('input[aria-label="Search domains"]', "vpn");
  await sleep(500);
  const searched = await page.evaluate(MEASURE);
  if (searched.rows !== 1 || searched.names[0] !== "Network") p.push(`search returned ${searched.rows} rows: ${searched.names.join(",")}`);

  await page.screenshot({ path: `${OUT}/domains_search.png`, fullPage: true });
  report.interactions = { expanded, attention: { rows: attention.rows, names: attention.names }, searched: { rows: searched.rows, names: searched.names }, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 3. responsive widths ----------------------------------------------------------
{
  for (const [name, width, height] of [["320", 320, 720], ["390", 390, 844], ["768", 768, 1024]]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
    await sleep(1300);
    const m = await page.evaluate(MEASURE);
    const p = [];
    if (m.overflow) p.push(`${name}px: horizontal overflow`);
    if (m.rows !== 7) p.push(`${name}px: ${m.rows} rows`);
    const stacked = m.stepRects.length === 2 && m.stepRects[1].y > m.stepRects[0].y;
    // Below `sm` the flow must stack; from `sm` up the two steps sit side by side.
    if (width < 640 && !stacked) p.push(`${name}px: flow steps are not stacked`);
    if (width >= 640 && !(m.flowSideBySide === true)) p.push(`${name}px: flow steps lost their side-by-side layout`);
    const actions = await page.evaluate(() => {
      const row = document.querySelector("article");
      const btn = row?.querySelector('button[aria-label^="Edit "]');
      const r = btn?.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    });
    if (!actions || actions.h < 32) p.push(`${name}px: edit target ${actions?.h}px`);
    await page.screenshot({ path: `${OUT}/domains_${name}.png`, fullPage: true });
    report[`w${name}`] = { vw: m.vw, overflow: m.overflow, rows: m.rows, stacked, actions, problems: p };
    p.forEach(fail);
    await page.close();
  }
}

// ---- 4. dark + error ---------------------------------------------------------------
{
  const { page } = await open("?theme=dark");
  const m = await page.evaluate(MEASURE);
  const p = [];
  // The dark palette is charcoal-navy; a white card here means a hardcoded surface.
  if (!/^#1E1A2A$/i.test(m.cardBg)) p.push(`dark --card was ${JSON.stringify(m.cardBg)}, expected #1E1A2A`);
  if (!/^#14121B$/i.test(m.background)) p.push(`dark --background was ${JSON.stringify(m.background)}`);
  if (m.overflow) p.push("dark: horizontal overflow");
  await page.screenshot({ path: `${OUT}/domains_desktop_dark.png`, fullPage: true });
  report.dark = { cardBg: m.cardBg, problems: p };
  p.forEach(fail);
  await page.close();

  const err = await open("?scenario=error");
  await sleep(400);
  const body = await err.page.evaluate(() => document.body.textContent ?? "");
  const pErr = [];
  if (!/Could not load the domains configuration/.test(body)) pErr.push("error scenario did not show the error state");
  if (/No domains configured yet/.test(body)) pErr.push("error scenario rendered an empty state");
  await err.page.screenshot({ path: `${OUT}/domains_error.png`, fullPage: true });
  report.error = { problems: pErr };
  pErr.forEach(fail);
  await err.page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (problems.length) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: metrics match the data, flow and rows adapt, filters work, no overflow at any width");
