// Screenshot the connector scope control at desktop and phone widths, closed and open.
//
// Why a harness instead of the running app: the chat page is behind auth and verification
// must not sign in as anyone. The harness renders the SAME component with the SAME
// stylesheet, fed by the payload the live endpoint returns today.
//
// What it MEASURES rather than looks at: documentElement.scrollWidth vs clientWidth. A pill
// that overflows does not throw and is easy to miss by eye at 390px — this app has already
// shipped that bug once (a provenance URL widened a card to 462px inside a 390px viewport),
// so overflow is asserted numerically here and the screenshot is only corroboration.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5214;
const URL = `http://localhost:${PORT}/scope-harness.html`;

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(URL); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness server not reachable at ${URL}`); }
await sleep(2500);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const report = {};
let failed = false;

for (const [name, vp] of [
  ["desktop", { width: 1440, height: 900 }],
  ["mobile", { width: 390, height: 844 }],
]) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.setViewport({ ...vp, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1200);

  const closed = await page.evaluate(() => {
    const de = document.documentElement;
    const pills = [...document.querySelectorAll('button[aria-haspopup="listbox"]')];
    return {
      scrollW: de.scrollWidth, clientW: de.clientWidth,
      pills: pills.length,
      // the pill must not grow with the number of selected connectors
      pillWidths: pills.map((p) => Math.round(p.getBoundingClientRect().width)),
      labels: pills.map((p) => p.textContent?.trim() ?? ""),
    };
  });
  await page.screenshot({ path: `${OUT}/scope_${name}_closed.png` });

  // Open the FIRST pill (the phone header's), which is where the popover can overflow.
  await page.evaluate(() => {
    const p = document.querySelector('button[aria-haspopup="listbox"]');
    if (p instanceof HTMLElement) p.click();
  });
  await sleep(700);

  const open = await page.evaluate(() => {
    const de = document.documentElement;
    const box = document.querySelector('[role="listbox"]');
    const r = box?.getBoundingClientRect();
    return {
      scrollW: de.scrollWidth, clientW: de.clientWidth,
      open: !!box,
      // the popover must stay inside the viewport on a phone
      boxRight: r ? Math.round(r.right) : null,
      boxLeft: r ? Math.round(r.left) : null,
      boxTop: r ? Math.round(r.top) : null,
      boxBottom: r ? Math.round(r.bottom) : null,
      viewportH: window.innerHeight,
      options: [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()),
    };
  });
  await page.screenshot({ path: `${OUT}/scope_${name}_open.png` });

  const overflow = open.scrollW > open.clientW;
  // Vertical too: a popover that opens above the header is "open" and invisible, which is
  // exactly what a horizontal-only check missed.
  const boxOutside = open.boxRight !== null && (
    open.boxRight > open.clientW + 1 || open.boxLeft < -1 ||
    open.boxTop < -1 || open.boxBottom > open.viewportH + 1
  );
  if (overflow || boxOutside || errors.length) failed = true;

  report[name] = { closed, open, overflow, boxOutside, jsErrors: errors };
  await page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (failed) { console.error("\nFAIL: overflow, popover outside the viewport, or JS errors"); process.exit(1); }
console.log("\nOK: no overflow, popover inside the viewport, no JS errors");