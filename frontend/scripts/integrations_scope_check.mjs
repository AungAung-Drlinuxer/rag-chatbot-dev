// Dev-line scope check: the Integrations catalogue must offer exactly Confluence and Jira.
//
// Renders the real Settings page (settings-page-harness.html, stubbed API) and asserts what
// the dev build actually shows a user — bundle grep cannot prove this, because the hidden
// providers stay in the JavaScript even when the UI never renders them.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });
const PORT = 5237;
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
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle2" });
await sleep(800);

// Open Settings → Integrations.
await page.evaluate(() => {
  const tab = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Integrations");
  tab?.click();
});
await sleep(900);
// Providers are opt-in, so a fresh profile starts with an empty enabled list and the
// catalogue behind "Browse integrations". Open it — the catalogue is what must be scoped.
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")]
    .find((b) => /Browse integrations|Add integration/i.test(b.textContent ?? ""));
  btn?.click();
});
await sleep(900);

const state = await page.evaluate(() => {
  // The summary strip ("N of M integrations enabled") lives inside the catalogue, which is
  // the only surface in scope. The page also lists integration STATUS cards (LDAP / AD,
  // Confluence…) that are not part of the catalogue and must not be counted.
  const summaryHost = [...document.querySelectorAll("p, h2, h3")]
    .find((p) => /integrations enabled/.test(p.textContent ?? ""));
  // The summary is its own card now; the catalogue cards are its siblings in the same
  // column, so take the parent — that still excludes the service-status rail.
  const panel = summaryHost?.closest("section")?.parentElement ?? document.body;
  const text = panel.innerText;
  const summary = text.match(/(\d+) of (\d+) integrations enabled/);
  const names = ["Confluence", "Jira", "LDAP / Active Directory", "Keycloak SSO", "Notion", "Anytype", "XWiki", "Hashnode", "OpenProject", "ClickUp"];
  return {
    shown: names.filter((n) => new RegExp(`\\b${n}\\b`).test(text)),
    summary: summary ? summary.slice(1, 3) : null,
    tabs: [...document.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "")
      .filter((t) => ["Knowledge & docs", "Work tracking", "Identity & access"].includes(t)),
  };
});

await page.screenshot({ path: `${OUT}/dev_integrations_scope.png` });
await browser.close();
dev.kill();

const problems = [];
const visible = [...state.shown].sort().join(",");
if (visible !== "Confluence,Jira,Keycloak SSO,LDAP / Active Directory") {
  problems.push(`the catalogue offers [${visible}] — expected Confluence, Jira, LDAP / Active Directory and Keycloak SSO`);
}
if (!state.summary || state.summary[1] !== "4") problems.push(`summary should read "x of 4", got ${JSON.stringify(state.summary)}`);
if (!state.tabs.includes("Identity & access")) problems.push("the Identity & access tab is missing");

console.log(JSON.stringify(state, null, 2));
if (errs.length) problems.push(`page errors: ${errs.slice(0, 2).join(" | ")}`);
if (problems.length) {
  console.log(`\nFAILED (${problems.length})`);
  problems.forEach((p) => console.log(" - " + p));
  process.exit(1);
}
console.log("\nOK: the catalogue offers Confluence, Jira, LDAP and Keycloak SSO");
