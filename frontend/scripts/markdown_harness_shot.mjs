// Screenshot the markdown harness at desktop and phone widths.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";   // QA images live at the repo root
const PORT = 5199;
const URL = `http://localhost:${PORT}/harness.html`;

// Start the dev server (not the app bundle) — the harness is dev-only.
// Readiness is polled over HTTP rather than parsed from vite's stdout: the banner text
// varies and a stale server from a previous run makes stdout-based detection unreliable.
const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch { return false; }
}

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(URL);
  if (!up) await sleep(1000);
}
if (!up) { dev.kill(); throw new Error(`harness server not reachable at ${URL}`); }
await sleep(1500);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {};
for (const [name, vp, shot] of [
  ["desktop", { width: 1100, height: 1400, deviceScaleFactor: 2 }, OUT + "/tables_render_desktop.png"],
  ["mobile", { width: 390, height: 1500, isMobile: true, deviceScaleFactor: 2 }, OUT + "/tables_render_mobile.png"],
]) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(2500);
  const info = await page.evaluate(() => {
    const tables = [...document.querySelectorAll("table")];
    const docW = document.documentElement.clientWidth;
    return {
      tables: tables.length,
      stacked: tables.map((t) => t.parentElement.getAttribute("data-stacked")),
      offscreenCells: tables.map((t) => {
        const w = t.parentElement.getBoundingClientRect();
        return [...t.querySelectorAll("tbody td")].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.right > w.right + 1 || r.left < w.left - 1;
        }).length;
      }),
      labels: tables.map((t) => [...(t.querySelector("tbody tr")?.querySelectorAll("td") || [])]
        .map((c) => c.getAttribute("data-label")).join(" | ")),
      cols: tables.map((t) => t.querySelectorAll("thead th").length),
      rows: tables.map((t) => t.querySelectorAll("tbody tr").length),
      // A table wider than the viewport must be inside a scrollable wrapper, not clipped.
      clipped: tables.filter((t) => {
        const w = t.parentElement;
        return w && w.scrollWidth > w.clientWidth + 1 && getComputedStyle(w).overflowX !== "auto";
      }).length,
      fencedTable: [...document.querySelectorAll("pre")].filter((p) => /\|\s*-{2,}/.test(p.textContent || "")).length,
      literalBold: /\*\*/.test(document.body.innerText),
      pageOverflow: document.documentElement.scrollWidth > docW + 2,
    };
  });
  await page.screenshot({ path: shot, fullPage: true });
  report[name] = { ...info, shot };
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
process.exit(0);