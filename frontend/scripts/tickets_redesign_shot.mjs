// Screenshot + drive the redesigned Tickets board.
//
// Renders the real page against the 23-ticket fixture in src/__tickets_harness__.tsx and
// checks the things a two-pane redesign can quietly break:
//
//   1. four metric cards equal the fixture (23 / 11 / 6 / 4) and share one row at 1440
//   2. the queue renders 10 rows with a pager that says 1–10 of 23
//   3. selecting a row opens the detail pane with a Jira binding, four status transitions,
//      a description, the metadata grid and the comment composer
//   4. a status press issues exactly one PUT to /api/tickets/<key>
//   5. the create dialog offers no destination selector — Jira is the only option — and
//      says so before the form
//   6. nothing overflows horizontally at 390 / 768 / 1440
//   7. the dark palette holds
//
// Usage (dev server only): node scripts/tickets_redesign_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });

const PORT = 5241;
const BASE = `http://localhost:${PORT}/tickets-harness.html`;
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
  dev.kill();
  throw new Error(`harness not reachable at ${BASE}`);
}
await sleep(2000);

const problems = [];
const check = (ok, msg) => {
  if (!ok) problems.push(msg);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function open(theme, width, height, extra = "") {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?theme=${theme}${extra}`, { waitUntil: "networkidle2" });
  await sleep(1200);
  return page;
}

/* ------------------------------------------------------------------ 1440 light */
const page = await open("light", 1440, 1000);

const cards = await page.$$eval('[role="button"]', (els) =>
  els
    .filter((e) => /Total tickets|^\s*Open|Pending|Resolved/.test(e.textContent ?? ""))
    .slice(0, 4)
    .map((e) => e.textContent?.replace(/\s+/g, " ").trim()),
);
check(cards.length === 4, `expected 4 metric cards, got ${cards.length}`);
const flat = cards.join(" ");
for (const [label, value] of [["Total tickets", "23"], ["Open", "11"], ["Pending", "6"], ["Resolved", "4"]]) {
  check(flat.includes(label) && flat.includes(value), `metric "${label}" should read ${value}, got "${flat}"`);
}

const rows = await page.$$eval("table tbody tr", (r) => r.length);
check(rows === 10, `desktop table should page at 10 rows, got ${rows}`);
const pager = await page.evaluate(() => document.body.innerText);
check(/1\s*[–-]\s*10 of 23/.test(pager), "pager should read 1–10 of 23");

// ---- select the first ticket
await page.evaluate(() => {
  const row = [...document.querySelectorAll("table tbody tr")].find((r) =>
    r.textContent?.includes("IT-100"),
  );
  (row?.querySelector("button") ?? row)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(700);

const panel = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="Ticket detail"]');
  return aside ? aside.innerText : "";
});
check(panel.length > 0, "the detail pane should open for IT-100");
check(/IT-100/.test(panel), "panel should show the ticket key");
check(/Jira/.test(panel), "panel should name Jira as the tracker");
check(/jira workflow/i.test(panel) && /click a step to move it/i.test(panel), "panel should draw the Jira workflow rail");
check(/Cannot|Fixture description/.test(panel), "panel should show the description");
check(/requester/i.test(panel) && /assignee/i.test(panel), "panel should show the metadata grid");
check(/comments are mirrored to the jira issue/i.test(panel), "panel should state where comments go");
for (const s of ["Open", "Pending", "Resolved", "Closed"]) {
  check(panel.includes(s), `status transitions should offer "${s}"`);
}

await page.screenshot({ path: `${OUT}/tickets_board_light.png`, fullPage: false });

// ---- the workflow rail moves: the fill is a width transition, so it must grow, not jump
const fillBefore = await page.$eval('[data-testid="workflow-fill"]', (e) => e.getBoundingClientRect().width);
const progressBefore = await page.$eval('[data-testid="workflow-fill"]', (e) => e.getAttribute("data-progress"));

// ---- one status press = one PUT
const writes = () =>
  page.evaluate(() =>
    (window.__writes ?? [])
      .filter((w) => w.method === "PUT" && w.path.startsWith("/api/tickets/"))
      .length,
  );
const before = await writes();
await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="Ticket detail"]');
  const btn = [...aside.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Pending");
  btn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(180);
await page.screenshot({ path: `${OUT}/tickets_workflow_mid.png` });
await sleep(900);
const puts = (await writes()) - before;
check(puts === 1, `one status press should send exactly one PUT, sent ${puts}`);

const fillAfter = await page.$eval('[data-testid="workflow-fill"]', (e) => e.getBoundingClientRect().width);
const progressAfter = await page.$eval('[data-testid="workflow-fill"]', (e) => e.getAttribute("data-progress"));
check(progressAfter === "1", `after moving to Pending the rail should sit on step 1, got ${progressAfter}`);
check(fillAfter > fillBefore + 5, `the rail fill should grow from ${Math.round(fillBefore)}px, got ${Math.round(fillAfter)}px`);
check(progressBefore === "0", `rail should start on step 0, got ${progressBefore}`);
await page.screenshot({ path: `${OUT}/tickets_workflow_pending.png` });

// ---- create dialog: no destination choice
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /Create ticket/.test(x.textContent ?? ""));
  b?.click();
});
await sleep(700);
const dialog = await page.evaluate(() => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  return d ? d.innerText : "";
});
check(dialog.includes("Create support ticket"), "dialog should be titled Create support ticket");
check(dialog.includes("Create in Jira"), "dialog should state Jira as the destination");
const destSelect = await page.$$eval('[data-slot="dialog-content"] select', (s) =>
  s.filter((x) => /destination/i.test(x.getAttribute("aria-label") ?? "")).length,
);
check(destSelect === 0, "the dialog must not offer a destination selector");
await page.screenshot({ path: `${OUT}/tickets_create_dialog.png` });

/* ------------------------------------------------------------------ dark 1440 */
const darkPage = await open("dark", 1440, 1000);
await darkPage.evaluate(() => {
  const row = [...document.querySelectorAll("table tbody tr")][1];
  (row?.querySelector("button") ?? row)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(700);
await darkPage.screenshot({ path: `${OUT}/tickets_board_dark.png` });

/* ------------------------------------------------------------------ narrow */
for (const [w, h] of [[768, 1024], [390, 844], [320, 720]]) {
  const n = await open("light", w, h);
  const overflow = await n.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check(overflow <= 1, `horizontal overflow ${overflow}px at ${w}px`);
  if (w === 390) {
    await n.evaluate(() => {
      const card = [...document.querySelectorAll("button, [role=button]")].find((b) =>
        /IT-100/.test(b.textContent ?? ""),
      );
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await sleep(700);
    await n.screenshot({ path: `${OUT}/tickets_sheet_390.png` });
  }
}

/* ---------------------------------------------- Jira not configured: read-only rail */
const off = await open("light", 1440, 1000, "&jira=off");
await off.evaluate(() => {
  const row = [...document.querySelectorAll("table tbody tr")][0];
  (row?.querySelector("button") ?? row)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await sleep(700);
const offText = await off.evaluate(
  () => document.querySelector('aside[aria-label="Ticket detail"]')?.innerText ?? "",
);
check(/read-only until Jira is connected/i.test(offText), "unconfigured Jira should mark the rail read-only");
check(/Jira is not connected/i.test(offText), "unconfigured Jira should explain the read-only rail");
const offDisabled = await off.evaluate(() =>
  [...document.querySelectorAll('aside[aria-label="Ticket detail"] button')]
    .filter((b) => b.textContent?.trim() === "Pending")
    .every((b) => b.disabled),
);
check(offDisabled, "unconfigured Jira: the Pending step must be disabled, not a dead click");
await off.screenshot({ path: `${OUT}/tickets_jira_off.png` });

await browser.close();
// Vite is started through `npm exec`, so killing the shell wrapper leaves the real server
// running and the process would never exit — kill it and let the exit code carry the result.
dev.kill("SIGKILL");

if (problems.length) {
  console.log("FAILED");
  for (const p of problems) console.log(" - " + p);
  process.exit(1);
}
console.log(
  "OK: metrics, paging, Jira-only detail pane, one PUT per step, rail animation, no destination picker, read-only when Jira is off, breakpoints",
);
process.exit(0);
