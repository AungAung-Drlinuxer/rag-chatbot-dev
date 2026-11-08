// Drives the Add / Edit domain sheet and asserts the behaviour the redesign is supposed to
// provide. Renders the real page + real sheet against the `/api/admin/domains` contract
// (`src/__domains_harness__.tsx`), with mutations recorded instead of sent.
//
//   1. create opens empty, and submitting it empty blocks with INLINE field errors
//   2. keywords are chips: Enter adds, comma adds, duplicate is refused with a reason,
//      the X removes one, and the submitted payload carries a real array
//   3. edit is visibly a different state: prefilled, key read-only behind "Change key",
//      "Save changes" disabled until dirty, and an invalid Jira key reports inline
//   4. the sheet is full-width on mobile with reachable footer actions, no overflow
//   5. dark mode keeps the sheet on the dark palette
//
// Usage (dev server only): node scripts/domain_form_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5232;
const BASE = `http://localhost:${PORT}/domains-harness.html`;

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
const problems = [];
const fail = (m) => problems.push(m);
const report = {};

async function page(query = "", width = 1280, height = 1000) {
  const p = await browser.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.setViewport({ width, height, deviceScaleFactor: 2 });
  await p.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1200);
  return { p, errs };
}

const bodyText = (p) => p.evaluate(() => document.body.textContent ?? "");
const clickText = async (p, text, tag = "button") =>
  p.evaluate((t, g) => {
    const el = [...document.querySelectorAll(g)].find((b) => (b.textContent ?? "").trim() === t);
    el?.click();
    return !!el;
  }, text, tag);

// ---- 1. create: empty state + inline validation ------------------------------------
{
  const { p, errs } = await page();
  const q = [];
  if (errs.length) q.push(`JS error: ${errs[0]}`);

  const opened = await clickText(p, "Add domain");
  await sleep(700);
  const head = await bodyText(p);
  if (!opened) q.push("no Add domain button on the page header");
  if (!/New routing domain/.test(head)) q.push("create sheet did not open with its title");
  if (!/Create domain/.test(head)) q.push("create action missing");
  if (/Save changes/.test(head)) q.push("create state shows the edit action");

  // Submit while empty → must not close, must show both required messages.
  await clickText(p, "Create domain");
  await sleep(500);
  const after = await bodyText(p);
  const stillOpen = await p.evaluate(() => !!document.querySelector('button[type="submit"]'));
  if (!stillOpen) q.push("empty create submitted and closed the sheet");
  if (!/A display name is required\./.test(after)) q.push("missing inline display-name error");
  if (!/A domain key is required\./.test(after)) q.push("missing inline domain-key error");
  if (await p.evaluate(() => !!document.querySelector('[aria-invalid="true"]'))) {
    // expected — every invalid input marks itself
  } else {
    q.push("invalid inputs are not marked aria-invalid");
  }

  await p.screenshot({ path: `${OUT}/domain_form_create_errors.png`, fullPage: false });
  report.createEmpty = { opened, problems: q };
  q.forEach(fail);
  await p.close();
}

// ---- 2. create: chips + payload ----------------------------------------------------
{
  const { p } = await page();
  const q = [];
  await clickText(p, "Add domain");
  await sleep(600);

  await p.type("#domain-name", "Payroll & Benefits");
  await p.type("#domain-key", "payroll_benefits");
  await p.click("#domain-keywords");
  await p.type("#domain-keywords", "payroll");
  await p.keyboard.press("Enter");
  await p.type("#domain-keywords", "leave request,");
  await sleep(300);

  const chips = () => p.evaluate(() =>
    [...document.querySelectorAll('button[aria-label^="Remove keyword "]')].map((b) => b.getAttribute("aria-label")),
  );
  let c = await chips();
  if (c.length !== 2) q.push(`after Enter+comma there were ${c.length} chips: ${c.join("|")}`);

  // duplicate is refused, with a visible reason, and does not add a chip
  await p.type("#domain-keywords", "Payroll");
  await p.keyboard.press("Enter");
  await sleep(300);
  const dupText = await bodyText(p);
  c = await chips();
  if (c.length !== 2) q.push(`duplicate keyword was added (${c.length} chips)`);
  if (!/Already in this domain's keyword list/.test(dupText)) q.push("duplicate had no inline reason");

  // remove one via its own X
  await p.click('button[aria-label="Remove keyword payroll"]');
  await sleep(250);
  c = await chips();
  if (c.length !== 1 || !c[0].includes("leave request")) q.push(`remove produced ${c.join("|")}`);

  // backspace on an empty draft removes the last chip
  await p.click("#domain-keywords");
  await p.keyboard.press("Backspace");
  await sleep(250);
  c = await chips();
  if (c.length !== 0) q.push("backspace did not remove the last chip");

  // rebuild, then submit
  await p.type("#domain-keywords", "payroll, leave request, tax");
  await p.keyboard.press("Enter");
  await p.type("#domain-jira", "hr");
  await sleep(200);
  const jiraValue = await p.$eval("#domain-jira", (el) => el.value);
  if (jiraValue !== "HR") q.push(`Jira key was not normalized to uppercase (${jiraValue})`);

  await p.screenshot({ path: `${OUT}/domain_form_create_filled.png`, fullPage: false });
  await clickText(p, "Create domain");
  await sleep(800);

  const sent = await p.evaluate(() => (window).__sent ?? []);
  const post = sent.find((s) => s.method === "POST");
  if (!post) q.push("no POST was sent");
  else {
    if (post.body.domain_key !== "payroll_benefits") q.push(`payload key ${post.body.domain_key}`);
    if (post.body.display_name !== "Payroll & Benefits") q.push(`payload name ${post.body.display_name}`);
    if (!Array.isArray(post.body.keywords) || post.body.keywords.length !== 3) q.push(`payload keywords ${JSON.stringify(post.body.keywords)}`);
    if (post.body.jira_project !== "HR") q.push(`payload jira ${post.body.jira_project}`);
    if (post.body.is_active !== true) q.push("payload active flag missing");
  }
  const closed = await p.evaluate(() => !document.querySelector("#domain-name"));
  if (!closed) q.push("sheet stayed open after a successful create");

  report.createFlow = { chips, jiraValue, post: post?.body ?? null, problems: q };
  q.forEach(fail);
  await p.close();
}

// ---- 3. edit: distinct state, read-only key, dirty gating ---------------------------
{
  const { p } = await page();
  const q = [];
  await p.evaluate(() => {
    const row = [...document.querySelectorAll("article")].find((a) => /Database/.test(a.textContent ?? ""));
    row?.querySelector('button[aria-label^="Edit "]')?.click();
  });
  await sleep(700);
  const head = await bodyText(p);
  if (!/^Edit/.test((head.match(/Edit|Create/) ?? [""])[0] ?? "")) q.push("edit eyebrow not shown");
  if (!/Database/.test(head)) q.push("edit sheet does not name the domain");
  if (/New routing domain/.test(head)) q.push("edit reuses the create title");
  if (!/Change key/.test(head)) q.push("key is not gated behind Change key");

  const name = await p.$eval("#domain-name", (el) => el.value);
  if (name !== "Database") q.push(`edit did not prefill the name (${name})`);

  const saveDisabled = await p.evaluate(() =>
    [...document.querySelectorAll('button[type="submit"]')].some((b) => (b.textContent ?? "").includes("Save changes") && b.disabled),
  );
  if (!saveDisabled) q.push("Save changes is enabled before anything changed");

  // invalid Jira key → inline message, then a valid one
  await p.click("#domain-jira");
  await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control");
  await p.type("#domain-jira", "9");
  await sleep(350);
  if (!/Jira project keys look like ITHD or DBOPS/.test(await bodyText(p))) q.push("invalid Jira key had no inline error");

  await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control");
  await p.keyboard.press("Backspace");
  await sleep(250);

  await p.type("#domain-desc", " Updated.");
  await sleep(300);
  const saveEnabled = await p.evaluate(() =>
    [...document.querySelectorAll('button[type="submit"]')].some((b) => (b.textContent ?? "").includes("Save changes") && !b.disabled),
  );
  if (!saveEnabled) q.push("Save changes did not enable after a real edit");

  // rename gate reveals a warning + input
  await clickText(p, "Change key");
  await sleep(350);
  const renamed = await bodyText(p);
  if (!/Renaming rewrites every article/.test(renamed)) q.push("Change key did not explain the cascade");
  if (!(await p.$("#domain-key"))) q.push("Change key did not reveal an editable key input");

  await p.screenshot({ path: `${OUT}/domain_form_edit.png`, fullPage: false });
  report.edit = { name, saveDisabled, saveEnabled, problems: q };
  q.forEach(fail);
  await p.close();
}

// ---- 4. responsive -----------------------------------------------------------------
{
  for (const [label, w, h] of [["390", 390, 844], ["320", 320, 720]]) {
    const { p } = await page("", w, h);
    const q = [];
    await clickText(p, "Add domain");
    await sleep(700);
    const m = await p.evaluate(() => {
      const submit = [...document.querySelectorAll('button[type="submit"]')].find((b) => /Create domain/.test(b.textContent ?? ""));
      const r = submit?.getBoundingClientRect();
      const panel = document.querySelector('[data-slot="dialog-content"]')?.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        panelWidth: Math.round(panel?.width ?? 0),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        submit: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      };
    });
    if (m.overflow) q.push(`${label}px: horizontal overflow with the sheet open`);
    if (Math.abs(m.panelWidth - m.vw) > 2) q.push(`${label}px: sheet is ${m.panelWidth}px wide, expected full width`);
    if (!m.submit || m.submit.h < 36) q.push(`${label}px: submit target ${m.submit?.h}px`);
    await p.screenshot({ path: `${OUT}/domain_form_${label}.png`, fullPage: false });
    report[`w${label}`] = { ...m, problems: q };
    q.forEach(fail);
    await p.close();
  }
}

// ---- 5. dark -----------------------------------------------------------------------
{
  const { p } = await page("?theme=dark");
  const q = [];
  await clickText(p, "Add domain");
  await sleep(700);
  const bg = await p.evaluate(() => getComputedStyle(document.querySelector('[data-slot="dialog-content"]')).backgroundColor);
  const rgb = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
  if (rgb[0] > 60 || rgb[1] > 60 || rgb[2] > 60) q.push(`dark sheet surface is ${bg}`);
  await p.screenshot({ path: `${OUT}/domain_form_dark.png`, fullPage: false });
  report.dark = { bg, problems: q };
  q.forEach(fail);
  await p.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (problems.length) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: create and edit are distinct, validation is inline, keywords are chips, mobile is full width");
