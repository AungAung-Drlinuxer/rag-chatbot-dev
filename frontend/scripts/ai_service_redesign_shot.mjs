// AI service redesign check — renders the REAL Settings page (settings-page-harness.html,
// stubbed API) and asserts the two-pane layout holds: main column of cards, a 340px rail
// carrying the effective-configuration summary and the save actions.
//
// Layout is measured, not eyeballed: the rail must sit to the right of the card column at
// xl, the action buttons must live inside it, and nothing may overflow at 390px.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });
const PORT = 5247;
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

async function openAi(page) {
  await page.evaluate(() => window.__SETTINGS_PAGE__?.select("AI service"));
  await sleep(1200);
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1100 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle2" });
await sleep(800);
await openAi(page);

const shotDir = await page.evaluate(() => {
  const main = document.querySelector("main") ?? document.body;
  const text = main.innerText;
  // The two top-level columns of the AI service panel.
  const shell = [...main.querySelectorAll("div")].find((d) => d.className.includes("xl:grid-cols-[minmax(0,1fr)_340px]"));
  const cols = shell ? [...shell.children] : [];
  const rail = cols[1];
  const cards = cols[0] ? [...cols[0].children] : [];
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  const r = rect(rail);
  const c = rect(cols[0]);
  const saveBtn = [...(rail?.querySelectorAll("button") ?? [])].find((b) => /Save AI settings/.test(b.textContent ?? ""));
  return {
    hasShell: !!shell,
    text,
    cards: cards.length,
    mainWidth: c ? Math.round(c.width) : 0,
    railWidth: r ? Math.round(r.width) : 0,
    railRightOfMain: !!(r && c && r.left >= c.right - 1),
    railSticky: rail ? getComputedStyle(rail).position : "",
    saveInRail: !!saveBtn,
    saveBelowFold: saveBtn ? Math.round(rect(saveBtn).top) : -1,
    headings: [...main.querySelectorAll("h2")].map((h) => h.textContent.trim()).slice(0, 10),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});

if (!shotDir.hasShell) fail("the AI service panel is not the two-column shell");
if (shotDir.cards !== 4) fail(`expected 4 cards in the main column, saw ${shotDir.cards}`);
if (!shotDir.railRightOfMain) fail("the rail is not to the right of the cards");
if (shotDir.railWidth < 320 || shotDir.railWidth > 360) fail(`rail width is ${shotDir.railWidth}px, expected ~340`);
if (!shotDir.saveInRail) fail("Save AI settings is not in the rail");
if (shotDir.overflow > 0) fail(`horizontal overflow at 1440: ${shotDir.overflow}px`);
for (const s of [
  "Effective configuration", "Provider & credentials", "Model", "Retrieval & answer behaviour",
  "Save AI settings", "Test connection", "Remove stored credentials",
  "Confidence threshold", "Top K results", "Write-only",
]) {
  if (!shotDir.text.includes(s)) fail(`missing copy: ${s}`);
}
for (const bad of ["Database", "Network", "Identity & access", "Escalation"]) {
  if (shotDir.text.includes(bad)) fail(`stale section still rendered: ${bad}`);
}

await page.screenshot({ path: `${OUT}/ai_service_light.png`, fullPage: true });

// dark
await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); document.documentElement.classList.add("dark"); });
await sleep(500);
await page.screenshot({ path: `${OUT}/ai_service_dark.png`, fullPage: true });
await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); document.documentElement.classList.remove("dark"); });

// mobile
await page.setViewport({ width: 390, height: 900 });
await sleep(600);
const small = await page.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  railBelow: (() => {
    const main = document.querySelector("main") ?? document.body;
    const shell = [...main.querySelectorAll("div")].find((d) => d.className.includes("xl:grid-cols-[minmax(0,1fr)_340px]"));
    const cols = shell ? [...shell.children] : [];
    if (cols.length < 2) return false;
    return cols[1].getBoundingClientRect().top >= cols[0].getBoundingClientRect().bottom - 2;
  })(),
}));
if (small.overflow > 0) fail(`horizontal overflow at 390: ${small.overflow}px`);
if (!small.railBelow) fail("the rail does not stack under the cards at 390");
await page.screenshot({ path: `${OUT}/ai_service_390.png`, fullPage: true });

await browser.close();
dev.kill("SIGKILL");

if (errs.length) fails.push(...errs.map((e) => `page error: ${e}`));
if (fails.length) {
  console.log(`FAILED (${fails.length})`);
  for (const f of fails) console.log(` - ${f}`);
  process.exit(1);
}
console.log(
  `OK: two columns (${shotDir.mainWidth}+${shotDir.railWidth}px), ${shotDir.cards} cards, ` +
  `rail sticky=${shotDir.railSticky}, save in rail, no overflow at 1440/390`,
);
process.exit(0);
