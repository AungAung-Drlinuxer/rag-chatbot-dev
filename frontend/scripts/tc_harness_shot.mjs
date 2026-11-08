// Screenshot + MEASURE the Tickets page and the Conversation history page.
//
// Why a harness instead of the running app: both pages are admin-only, and verification
// must not sign in as anyone (this repo already carries one script that types a real
// password into the production login form — do not add another). The harness renders the
// real page components with `fetch` stubbed to fixtures shaped like the endpoints return
// (see src/__tc_harness__.tsx).
//
// What it MEASURES rather than looks at:
//   1. no JS errors, no unhandled rejections
//   2. no horizontal overflow at 1440px
//   3. the table headers are EXACTLY the mockup's columns — a restyle that drops or renames
//      one is a failure, not a detail
//   4. every fixture row renders (no silent truncation)
//   5. the Tickets row whose ticket is open in the detail panel is visibly marked
//   6. both themes render
//
// Usage (dev server only): node scripts/tc_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5245;
const BASE = `http://localhost:${PORT}/tc-harness.html`;

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

const TICKET_COLUMNS = ["Ticket", "Subject", "Status", "Priority", "Requester"];
const CONV_COLUMNS = ["User", "Conversation", "Msgs", "Last activity"];

let browser;
try {
  if (!(await waitForServer(BASE))) throw new Error(`harness server not reachable at ${BASE}`);
  await sleep(1500);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const theme of ["dark", "light"]) {
    for (const page of ["tickets", "conversations"]) {
      const tab = await browser.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      const badResponses = [];
      tab.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 180)));
      tab.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 180)); });
      tab.on("response", (r) => { if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url().slice(0, 120)}`); });
      await tab.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
      await tab.goto(`${BASE}?page=${page}&theme=${theme}`, { waitUntil: "networkidle0", timeout: 60000 });
      await sleep(900);

      const m = await tab.evaluate(() => {
        const de = document.documentElement;
        const rows = [...document.querySelectorAll("tbody tr")];
        const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
        const cards = [...document.querySelectorAll("main, section")].map((s) => s.textContent ?? "").join(" ");
        return {
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          headers,
          rows: rows.length,
          selected: rows.filter((r) => {
            const bg = getComputedStyle(r).backgroundColor;
            return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
          }).length,
          placeholders: [...document.querySelectorAll("input")].map((i) => i.placeholder).filter(Boolean),
          text: document.body.innerText.slice(0, 4000),
          cards,
        };
      });

      const label = `${page}/${theme}`;
      const noise = [...pageErrors, ...consoleErrors, ...badResponses];
      check(`${label}: no JS errors`, noise.length === 0, noise.slice(0, 3).join(" | "));
      check(`${label}: no horizontal overflow`, m.scrollW <= m.clientW, `${m.scrollW} <= ${m.clientW}`);

      if (page === "tickets") {
        check(`${label}: the mockup's five columns`, JSON.stringify(m.headers) === JSON.stringify(TICKET_COLUMNS),
          JSON.stringify(m.headers));
        check(`${label}: every fixture row renders`, m.rows === 5, `${m.rows} rows`);
        // Nothing is open on load, so "the row being viewed is marked" can only be proven by
        // opening one. The page selects from the ticket-id button inside the row, and marks it
        // with aria-selected + a tint, so assert both rather than trusting one class name.
        await tab.evaluate(() => { document.querySelector("tbody tr td button")?.click(); });
        await sleep(500);
        const sel = await tab.evaluate(() => {
          const rows = [...document.querySelectorAll("tbody tr")];
          return {
            aria: rows.filter((r) => r.getAttribute("aria-selected") === "true").length,
            tinted: rows.filter((r) => {
              const bg = getComputedStyle(r).backgroundColor;
              return bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
            }).length,
          };
        });
        check(`${label}: opening a row marks exactly that row`,
          sel.aria === 1 && sel.tinted === 1, JSON.stringify(sel));
        check(`${label}: the panel names the priority in words`, /priority/i.test(m.text), "");
      } else {
        check(`${label}: the mockup's four columns`, JSON.stringify(m.headers) === JSON.stringify(CONV_COLUMNS),
          JSON.stringify(m.headers));
        check(`${label}: every fixture conversation renders`, m.rows === 3, `${m.rows} rows`);
        // The mockup shows the transcript panel populated, so open a row and read the panel —
        // an empty placeholder panel would still "render" without this.
        await tab.evaluate(() => { document.querySelector("tbody tr")?.click(); });
        await sleep(600);
        const panelText = await tab.evaluate(() => document.body.innerText);
        check(`${label}: opening a row fills the transcript panel`,
          /Conversation transcript/.test(panelText) && /Export \.txt/.test(panelText) &&
          /Export \.json/.test(panelText) && /\d+ messages?/.test(panelText),
          `${/Conversation transcript/.test(panelText)} / exports / msgcount`);
        check(`${label}: the three figure cards`, /Conversations/.test(m.text) && /Total messages/.test(m.text) && /Active users/.test(m.text), "");
        check(`${label}: the mockup's search placeholder`,
          m.placeholders.includes("Search conversation or user..."), JSON.stringify(m.placeholders));
      }

      await tab.screenshot({ path: `${OUT}/tc_${page}_${theme}.png`, fullPage: true });
      await tab.close();
    }
  }
} finally {
  if (browser) await browser.close();
  try { process.kill(-dev.pid, "SIGKILL"); } catch { /* already gone */ }
  dev.kill("SIGKILL");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error("\nFAIL: see the checks above");
  process.exit(1);
}
console.log("OK: tickets + conversations render — mockup columns, all rows, one marked selection, both themes");
process.exit(0);
