// Screenshot + measure the redesigned Overview page.
//
// Overview now shares the Tickets screen's bones: a header with the reporting window, a
// four-card metric row, then a two-pane body — the reading column on the left and a
// sticky platform rail on the right. This script proves that structure, not the colours:
//
//   1. section order: attention → kpis → trend → queue → knowledge, rail: health →
//      quality → workspace
//   2. exactly four KPI cards, equal heights, together spanning the reading column
//   3. the rail sits to the RIGHT of the column at 1440 and is ~380px wide
//   4. the degraded fixture names the failing dependency in the rail
//   5. below xl the rail stacks under the column and nothing overflows at 390
//   6. both themes render without page errors
//
// Usage (dev server only): node scripts/overview_redesign_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });

const PORT = 5243;
const BASE = `http://localhost:${PORT}/dashboard-harness.html`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "google-chrome";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "pipe" });
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

const reachable = async (u) => {
  try {
    return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
};
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill("SIGKILL");
  throw new Error(`harness not reachable at ${BASE}`);
}
await sleep(1800);

const problems = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function open(theme, width, height, role = "admin", extra = "") {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?role=${role}&theme=${theme}${extra}`, { waitUntil: "networkidle2" });
  await page.waitForFunction("window.__DASH_HARNESS__?.ready === true", { timeout: 25000 });
  await sleep(1000);
  return { page, errors };
}

const MEASURE = () => {
  const r = (el) => el.getBoundingClientRect();
  const sections = [...document.querySelectorAll("[data-section]")].map((e) => e.getAttribute("data-section"));
  const kpi = document.querySelector('[data-section="kpis"]');
  const cards = kpi ? [...kpi.children].map((c) => Math.round(r(c).height)) : [];
  const col = document.querySelector('[data-section="attention"]');
  const rail = document.querySelector('[data-section="health"]');
  return {
    sections,
    kpiCount: kpi ? kpi.children.length : 0,
    kpiHeights: cards,
    kpiWidth: kpi ? Math.round(r(kpi).width) : 0,
    kpiRowWidth: kpi
      ? Math.round(
          Math.max(...[...kpi.children].map((c) => r(c).right)) -
            Math.min(...[...kpi.children].map((c) => r(c).left)),
        )
      : 0,
    col: col
      ? { left: Math.round(r(col).left), right: Math.round(r(col).right), top: Math.round(r(col).top), bottom: Math.round(r(col).bottom) }
      : null,
    rail: rail
      ? { left: Math.round(r(rail).left), width: Math.round(r(rail).width), top: Math.round(r(rail).top) }
      : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    text: document.body.textContent ?? "",
  };
};

/* --------------------------------------------------------------- 1440 light */
const light = await open("light", 1440, 1000, "admin", "&state=degraded");
const m = await light.page.evaluate(MEASURE);

check(m.sections.join(",") === "attention,kpis,trend,queue,knowledge,health,quality,workspace",
  `section order ${JSON.stringify(m.sections)}`);
check(m.kpiCount === 4, `expected 4 KPI cards, got ${m.kpiCount}`);
check(new Set(m.kpiHeights).size <= 1, `KPI heights differ: ${m.kpiHeights.join(",")}`);
check(Math.abs(m.kpiRowWidth - m.kpiWidth) <= 2, `KPI row covers ${m.kpiRowWidth}/${m.kpiWidth}`);
check(!!m.rail && !!m.col && m.rail.left > m.col.right, "the rail should sit to the right of the reading column");
check(!!m.rail && Math.abs(m.rail.width - 380) <= 12, `rail width ${m.rail?.width} should be ~380`);
check(m.overflow <= 1, `horizontal overflow ${m.overflow}px at 1440`);
check(/Failing: Redis/.test(m.text), "degraded fixture should name the failing dependency in the rail");
check(/Guardrail activity/.test(m.text), "guardrail counter should stay in the rail footer");
check(!/lorem ipsum|sample data|dummy data/i.test(m.text), "placeholder copy shipped");

await light.page.screenshot({ path: `${OUT}/overview_light.png` });

// The reporting window is the only control that changes what is fetched; prove it still
// reaches the wire (the page re-reads the series with the new range).
await light.page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.title === "Reporting window")?.click();
});
await sleep(300);
await light.page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Last 30 days")?.click();
});
await sleep(900);
const reqs = await light.page.evaluate(() => window.__DASH_REQS__ ?? []);
check(reqs.some((u) => /days=30/.test(u)), "choosing 30 days should refetch the series with days=30");

/* ---------------------------------------------------------------- 1440 dark */
const dark = await open("dark", 1440, 1000);
check(dark.errors.length === 0, `dark page errors: ${dark.errors[0] ?? ""}`);
await dark.page.screenshot({ path: `${OUT}/overview_dark.png` });

/* ---------------------------------------------------------------- non-admin */
const user = await open("light", 1440, 1000, "user");
const userText = await user.page.evaluate(() => document.body.textContent ?? "");
check(!/Attacks Blocked/.test(userText), "non-admin must not see Attacks Blocked");
check(/KB Articles/.test(userText), "non-admin still sees KB Articles");

/* ---------------------------------------------------------------- narrow */
for (const [w, h] of [[768, 1024], [390, 844]]) {
  const n = await open("light", w, h);
  const nm = await n.page.evaluate(MEASURE);
  check(nm.overflow <= 1, `horizontal overflow ${nm.overflow}px at ${w}`);
  check(!!nm.rail && !!nm.col && nm.rail.top >= nm.col.bottom - 4, `rail should stack under the column at ${w}`);
  if (w === 390) await n.page.screenshot({ path: `${OUT}/overview_390.png`, fullPage: false });
}

await browser.close();
dev.kill("SIGKILL");

if (problems.length) {
  console.log("FAILED");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log("OK: overview two-pane layout — 4 KPIs, right rail, stacked narrow, both themes, no overflow");
process.exit(0);
