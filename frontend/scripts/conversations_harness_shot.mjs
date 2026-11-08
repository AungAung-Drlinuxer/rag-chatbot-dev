// Screenshot + MEASURE the Conversation history page (admin-only, so no sign-in).
//
//   node scripts/conversations_harness_shot.mjs
//
// The claims this proves, arithmetically where possible:
//   1. no JS errors, no failed /api requests
//   2. three summary tiles on one row, equal width
//   3. the body is the same two-pane split as Overview: list column + 380px rail
//   4. the transcript rail is sticky and opens with real messages when a row is clicked
//   5. no horizontal overflow at 1600 or 390, and the grid collapses to one column at 390
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
const PORT = 5243;
const BASE = `http://localhost:${PORT}/conversations-harness.html`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

mkdirSync(OUT, { recursive: true });

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(), detached: true,
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", (d) => { const s = d.toString(); if (/error|Error/.test(s)) process.stderr.write(s); });

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disk-cache-size=1"],
});

try {
  if (!(await waitForServer(BASE))) throw new Error("vite dev server never came up");
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  const bad = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico|status of 404/.test(m.text()) && !/\/api\//.test(m.text())) return;
    errors.push(m.text());
  });
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  for (const theme of ["light", "dark"]) {
    await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/conversations_${theme}.png`, fullPage: true });

    if (theme === "light") {
      check("no JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
      const apiBad = bad.filter((b) => /\/api\//.test(b));
      check("every /api call answered", apiBad.length === 0, apiBad.slice(0, 3).join(" | "));

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("no horizontal overflow at 1600px", overflow <= 0, `overflow=${overflow}px`);

      const tiles = await page.evaluate(() => {
        // data-slot, not text: the label is uppercase-CSS'd and the value sits after it.
        const cards = [...document.querySelectorAll('[data-slot="summary-tile"]')];
        return {
          n: cards.length,
          rows: new Set(cards.map((c) => Math.round(c.getBoundingClientRect().top))).size,
          widths: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().width)))],
        };
      });
      check("3 summary tiles, one row, equal width",
        tiles.n === 3 && tiles.rows === 1 && tiles.widths.length === 1, JSON.stringify(tiles));

      const shell = await page.evaluate(() => {
        const grid = [...document.querySelectorAll("div")].find((d) =>
          /xl:grid-cols-\[minmax\(0,1fr\)/.test(d.className) && d.querySelector("table"));
        if (!grid) return null;
        const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").map((s) => Math.round(parseFloat(s)));
        const rail = grid.querySelector(":scope > div:last-child");
        return { cols, railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : 0 };
      });
      check("list + 380px rail, two columns at 1600px",
        shell && shell.cols.length === 2 && Math.abs(shell.railWidth - 380) <= 2,
        JSON.stringify(shell));

      // Open a transcript: the rail must fill with the fixture's turns.
      await page.click("table tbody tr");
      await sleep(600);
      const panel = await page.evaluate(() => {
        const rail = [...document.querySelectorAll("div")].find((d) =>
          /sticky/.test(d.className) && d.querySelector("h2, h3"));
        return {
          sticky: rail ? getComputedStyle(rail).position : "none",
          text: (rail?.textContent || "").slice(0, 400),
        };
      });
      check("transcript rail is sticky", panel.sticky === "sticky", panel.sticky);
      check("transcript shows the conversation turns",
        /VPN drops every ten minutes/.test(panel.text) && /IKEv2/.test(panel.text),
        panel.text.slice(0, 60));
      await page.screenshot({ path: `${OUT}/conversations_open.png`, fullPage: true });

      await page.setViewport({ width: 390, height: 900, deviceScaleFactor: 1 });
      await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle2" });
      await page.waitForSelector("table tbody tr", { timeout: 15000 });
      await sleep(400);
      const mobile = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cols: (() => {
          const grid = [...document.querySelectorAll("div")].find((d) =>
            /xl:grid-cols-\[minmax\(0,1fr\)/.test(d.className) && d.querySelector("table"));
          return grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
        })(),
      }));
      check("no horizontal overflow at 390px", mobile.overflow <= 0, `overflow=${mobile.overflow}px`);
      check("one column at 390px", mobile.cols === 1, `cols=${mobile.cols}`);
      await page.screenshot({ path: `${OUT}/conversations_390.png`, fullPage: true });
    }
  }
} finally {
  await browser.close();
  try { process.kill(-dev.pid, "SIGKILL"); } catch { /* already gone */ }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("  FAILED:\n" + failed.map((f) => `    - ${f.name} (${f.detail})`).join("\n"));
  process.exit(1);
}
