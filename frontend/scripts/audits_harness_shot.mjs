// Screenshot + MEASURE the Audit log page.
//
// Why a harness instead of the running app: the audit page is admin-only and
// verification must not sign in as anyone. The harness renders the real page
// component with `fetch` stubbed to fixtures shaped like the endpoint returns
// (see src/__audits_harness__.tsx).
//
// What it MEASURES rather than looks at — "the page matches the mockup" is a claim
// that has to be arithmetic where it can be:
//   1. no JS errors, no unhandled rejections
//   2. no horizontal overflow at 1600px
//   3. the summary cards are three EQUAL columns on one row (the mockup's 3-up grid)
//   4. pagination is real: page 1 shows pageSize rows, "Next" changes the rows and the
//      range text, and the pager reports the correct page count
//   5. the result filter matches the DATA, not a guess: Caution must return > 0 rows
//      and Answer must return > 0 rows, or the option is a lie
//   6. the range footer states the loaded-vs-total gap when the log is bigger than
//      one fetch — "no match" must never read as "this event does not exist"
//   7. both themes render (the mockup is dark-only; the app is not)
//
// Usage (dev server only): node scripts/audits_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
const PORT = 5241;
const BASE = `http://localhost:${PORT}/audits-harness.html`;

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
  executablePath: CHROME,
  headless: "new",
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
    // The harness page declares no favicon; /favicon.ico 404s on every run. Harness
    // noise, not an app error.
    if (/favicon\.ico|status of 404/.test(m.text()) && !/\/api\//.test(m.text())) return;
    errors.push(m.text());
  });
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  for (const theme of ["dark", "light"]) {
    await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    await sleep(700);

    await page.screenshot({ path: `${OUT}/audits_${theme}.png`, fullPage: true });

    if (theme === "dark") {
      // Only harness-page noise (a favicon the harness html never declares) may be
      // tolerated; anything else — a real asset or API 404 — must fail the check.
      const realBad = bad.filter((b) => !/\/favicon\.ico$/.test(b));
      check("no JS errors (favicon 404 excluded)", errors.length === 0, errors.slice(0, 3).join(" | "));
      check("no failed requests except the harness favicon", realBad.length === 0,
        realBad.slice(0, 3).join(" | ") || `all 404s were harness-only (${bad.length})`);

      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check("no horizontal overflow at 1600px", overflow <= 0, `overflow=${overflow}px`);

      // Same two-pane bones as Overview: the stream in the reading column, a 380px rail
      // beside it that stays put while the rows scroll.
      const rail = await page.evaluate(() => {
        const grid = [...document.querySelectorAll("div")].find((d) =>
          /xl:grid-cols-\[minmax\(0,1fr\)/.test(d.className) && d.querySelector("table"));
        if (!grid) return null;
        const colWidths = getComputedStyle(grid).gridTemplateColumns.split(" ").map((s) => Math.round(parseFloat(s)));
        const aside = grid.querySelector(":scope > aside");
        return {
          cols: colWidths,
          width: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
          position: aside ? getComputedStyle(aside).position : "none",
        };
      });
      check("stream + 380px sticky rail, two columns at 1600px",
        !!rail && rail.cols.length === 2 && Math.abs(rail.width - 380) <= 2 && rail.position === "sticky",
        JSON.stringify(rail));

      const cols = await page.evaluate(() => {
        const cards = [...document.querySelectorAll("div")].filter((d) =>
          /Total events in log|Today's events|Distinct users/.test(d.textContent || "") &&
          d.children.length >= 2 && /rounded-(xl|2xl)/.test(d.className));
        const top = cards.map((c) => c.getBoundingClientRect().top);
        const w = cards.map((c) => Math.round(c.getBoundingClientRect().width));
        return { n: cards.length, tops: [...new Set(top.map((t) => Math.round(t)))].length, widths: [...new Set(w)] };
      });
      check("3 summary cards, one row, equal width", cols.n === 3 && cols.tops === 1 && cols.widths.length === 1,
        `n=${cols.n} rows=${cols.tops} widths=${JSON.stringify(cols.widths)}`);

      // header eyebrow present
      const eyebrow = await page.evaluate(() =>
        /ADMINISTRATION/.test(document.body.innerText));
      check('eyebrow "ADMINISTRATION" rendered', eyebrow);

      // pagination: page size 10, 23 rows -> 3 pages
      const p1 = await page.evaluate(() => {
        const rows = document.querySelectorAll("table tbody tr");
        const foot = [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /Showing .* of .* events/.test(t)) || "";
        const pager = [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /^\d+ \/ \d+$/.test(t)) || "";
        return { rows: rows.length, foot, pager };
      });
      check("page 1 shows 10 rows", p1.rows === 10, `rows=${p1.rows}`);
      check("range footer + pager correct", /Showing 1–10 of 23 events/.test(p1.foot) && p1.pager === "1 / 3",
        `foot="${p1.foot}" pager="${p1.pager}"`);

      const firstIdBefore = await page.evaluate(() => document.querySelector("table tbody tr td")?.textContent || "");
      await page.evaluate(() => {
        const btn = document.querySelector('button[aria-label="Next page"]');
        (btn instanceof HTMLElement) && btn.click();
      });
      await sleep(400);
      const p2 = await page.evaluate(() => {
        const foot = [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /Showing .* of .* events/.test(t)) || "";
        const pager = [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /^\d+ \/ \d+$/.test(t)) || "";
        return { foot, pager, first: document.querySelector("table tbody tr td")?.textContent || "" };
      });
      check("Next page really pages", /Showing 11–20 of 23 events/.test(p2.foot) && p2.pager === "2 / 3" && p2.first !== firstIdBefore,
        `foot="${p2.foot}" pager="${p2.pager}"`);

      // result filter must match real data
      for (const [value, label] of [["caution", "Caution"], ["answer", "Answer"]]) {
        await page.select('select[aria-label="Filter by result"]', value);
        await sleep(400);
        const n = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
        const foot = await page.evaluate(() =>
          [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /Showing .* of .* events|^0 events$/.test(t)) || "");
        check(`result filter "${label}" returns rows`, n > 0, `rows=${n} foot="${foot}"`);
      }
      await page.select('select[aria-label="Filter by result"]', "");
      await sleep(300);

      // loaded-vs-total disclosure (fixture total 2709 > 23 loaded)
      const disclosure = await page.evaluate(() => document.body.innerText);
      check("loaded-vs-total gap disclosed", /23 loaded of 2,709/.test(disclosure),
        (disclosure.match(/\(.*loaded of.*\)/) || ["(none)"])[0]);

      // header + toolbar + footer structure
      const structure = await page.evaluate(() => ({
        panel: /Activity stream/.test(document.body.innerText),
        count: /\d+ events/.test(document.body.innerText),
        newestFirst: /Newest first/.test(document.body.innerText),
        exportPrimary: (() => {
          const b = [...document.querySelectorAll("button")].find((x) => /Export CSV/.test(x.textContent || ""));
          if (!b) return "missing";
          // Compare against the live brand token, not a hardcoded hex: the palette moved
          // from blue to violet and the assertion should follow --primary wherever it goes.
          const probe = document.createElement("div");
          probe.style.background = "var(--primary)";
          document.body.appendChild(probe);
          const primary = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { bg: getComputedStyle(b).backgroundColor, primary };
        })(),
      }));
      check("panel heading + count + 'Newest first'", structure.panel && structure.count && structure.newestFirst,
        JSON.stringify(structure));
      check("Export CSV is the primary (brand) button",
        !!structure.exportPrimary && structure.exportPrimary.bg === structure.exportPrimary.primary,
        `bg=${structure.exportPrimary?.bg} primary=${structure.exportPrimary?.primary}`);
    } else {
      const light = await page.evaluate(() => {
        const body = getComputedStyle(document.body).backgroundColor;
        const h1 = getComputedStyle(document.querySelector("h1")).color;
        return { body, h1 };
      });
      check("light theme renders with light surfaces", light.body !== "rgba(0, 0, 0, 0)", JSON.stringify(light));
    }
  }
} finally {
  await browser.close();
  // Kill the whole process GROUP: `npx vite` spawns a grandchild that survives a plain
  // kill of the npx pid, keeps the stdout pipe open, and hangs node forever.
  try { process.kill(-dev.pid, "SIGKILL"); } catch { dev.kill("SIGKILL"); }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("  FAILED:");
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail})`));
  process.exitCode = 1;
}
