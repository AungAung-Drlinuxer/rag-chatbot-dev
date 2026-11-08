// Settings tabs — the Integrations and Email server tabs use the same two-pane shell as
// AI service: a working column on the left, a 340px sticky rail on the right carrying the
// live status and the actions. This renders the REAL Settings page (stubbed API) and
// measures that, rather than trusting the markup.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });
const PORT = 5248;
const BASE = `http://localhost:${PORT}/settings-page-harness.html`;

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
if (!up) { dev.kill("SIGKILL"); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const fails = [];
const fail = (m) => fails.push(m);

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle2" });
await sleep(800);

/** Measure the two-column shell of whatever tab is open. */
const geometry = () =>
  page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const shell = [...main.querySelectorAll("div")].find((d) => d.className.includes("xl:grid-cols-[minmax(0,1fr)_340px]"));
    if (!shell) return { shell: false };
    const [col, rail] = [...shell.children];
    const c = col.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    return {
      shell: true,
      mainWidth: Math.round(c.width),
      railWidth: Math.round(r.width),
      railRight: r.left >= c.right - 1,
      railText: rail.innerText,
      mainText: col.innerText,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      railSticky: getComputedStyle(rail).position,
    };
  });

const open = async (label) => {
  await page.evaluate((l) => window.__SETTINGS_PAGE__?.select(l), label);
  await sleep(1200);
};

/* -------------------------------- Preferences ------------------------------- */
await open("Preferences");
let g = await geometry();
if (!g.shell) fail("Preferences is not two columns");
if (!g.railRight) fail("Preferences rail is not to the right");
if (g.railWidth < 320 || g.railWidth > 360) fail(`Preferences rail is ${g.railWidth}px`);
for (const s of ["your setup", "save changes", "discard changes"]) {
  if (!(g.railText ?? "").toLowerCase().includes(s)) fail(`Preferences rail is missing: ${s}`);
}
const footerGone = await page.evaluate(() => {
  const main = document.querySelector("main");
  const sticky = [...(main?.querySelectorAll("div") ?? [])].filter((d) => getComputedStyle(d).position === "sticky");
  // the rail is sticky too; the old page-level action bar is the one that is not the rail
  return sticky.every((d) => d.className.includes("xl:sticky"));
});
if (!footerGone) fail("the page-level save bar is still rendered");
for (const s of ["Chat", "Appearance", "Branding"]) {
  if (!g.mainText?.includes(s)) fail(`Preferences column is missing: ${s}`);
}
if (g.overflow > 0) fail(`Preferences overflows at 1440 by ${g.overflow}px`);
await page.screenshot({ path: `${OUT}/preferences_two_pane.png`, fullPage: true });

/* ------------------------------- Integrations ------------------------------- */
await open("Integrations");
g = await geometry();
if (!g.shell) fail("Integrations is not two columns");
if (!g.railRight) fail("Integrations rail is not to the right");
if (g.railWidth < 320 || g.railWidth > 360) fail(`Integrations rail is ${g.railWidth}px`);
for (const s of ["service status", "how this works"]) {
  if (!(g.railText ?? "").toLowerCase().includes(s)) fail(`Integrations rail is missing: ${s}`);
}
const statusCount = await page.evaluate(() =>
  (document.querySelector("main")?.innerText.match(/service status/gi) ?? []).length);
if (statusCount !== 1) fail(`"Service status" appears ${statusCount} times, expected once (in the rail)`);
if (!/integrations enabled/i.test(g.mainText ?? "")) fail("the catalogue summary strip is not in the main column");
if (g.overflow > 0) fail(`Integrations overflows at 1440 by ${g.overflow}px`);
await page.screenshot({ path: `${OUT}/integrations_two_pane.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); document.documentElement.classList.add("dark"); });
await sleep(500);
await page.screenshot({ path: `${OUT}/integrations_two_pane_dark.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); document.documentElement.classList.remove("dark"); });

/* -------------------------------- Email server ------------------------------ */
await open("Email server");
g = await geometry();
if (!g.shell) fail("Email server is not two columns");
if (!g.railRight) fail("Email server rail is not to the right");
if (g.railWidth < 320 || g.railWidth > 360) fail(`Email rail is ${g.railWidth}px`);
for (const s of ["Delivery", "Send & save", "Send test", "Save mail settings", "Send a test email to"]) {
  if (!g.railText?.includes(s)) fail(`Email rail is missing: ${s}`);
}
for (const s of ["Server", "Credentials & sender", "Alert emails"]) {
  if (!g.mainText?.includes(s)) fail(`Email main column is missing: ${s}`);
}
if (g.overflow > 0) fail(`Email overflows at 1440 by ${g.overflow}px`);
await page.screenshot({ path: `${OUT}/email_two_pane.png`, fullPage: true });

await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); document.documentElement.classList.add("dark"); });
await sleep(500);
await page.screenshot({ path: `${OUT}/email_two_pane_dark.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); document.documentElement.classList.remove("dark"); });

/* ---------------------------------- mobile ---------------------------------- */
await page.setViewport({ width: 390, height: 900 });
await sleep(600);
for (const label of ["Preferences", "Integrations", "Email server"]) {
  await open(label);
  const small = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const shell = [...main.querySelectorAll("div")].find((d) => d.className.includes("xl:grid-cols-[minmax(0,1fr)_340px]"));
    const cols = shell ? [...shell.children] : [];
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stacked: cols.length >= 2 && cols[1].getBoundingClientRect().top >= cols[0].getBoundingClientRect().bottom - 2,
    };
  });
  if (small.overflow > 0) fail(`${label} overflows at 390 by ${small.overflow}px`);
  if (!small.stacked) fail(`${label} rail does not stack under the column at 390`);
}
await page.screenshot({ path: `${OUT}/settings_tabs_390.png`, fullPage: true });

await browser.close();
dev.kill("SIGKILL");

if (errs.length) fails.push(...errs.map((e) => `page error: ${e}`));
if (fails.length) {
  console.log(`FAILED (${fails.length})`);
  for (const f of fails) console.log(` - ${f}`);
  process.exit(1);
}
console.log("OK: Preferences, Integrations and Email server all render as column + 340px rail, status and actions in the rail, no overflow at 1440/390");
process.exit(0);
