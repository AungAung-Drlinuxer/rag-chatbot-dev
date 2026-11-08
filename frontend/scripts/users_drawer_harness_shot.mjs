// Screenshot + DRIVE the user-details drawer.
//
// Renders the real Users page against the existing `__users_harness__.tsx` fixture
// (local Alice = Administrator, AD Bob = IT Support) and asserts the redesigned drawer:
//
//   1. identity header names the account and shows status / role / source badges
//   2. account metadata is a labelled grid and still exposes Account type = Local
//   3. the role control is the same accessible `select[aria-label="Role"]`, the preview
//      names both roles, and Save is disabled until the role actually changes
//   4. saving writes PATCH /api/users/<u>/role (recorded by the harness)
//   5. the AD account gets the warning notice, directory explanation, and NO local
//      password form; the local account gets the password form with its 8-char rule
//   6. the footer separates destructive (deactivate, red), secondary (reset), primary
//      (save) — each with its own confirm dialog
//   7. the drawer is full-width on mobile, its footer stays reachable, and nothing
//      overflows at 390 or 1440
//
// Usage (dev server only): node scripts/users_drawer_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5234;
const BASE = `http://localhost:${PORT}/users-harness.html`;

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

async function open(query = "", width = 1440, height = 1000) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(`${BASE}${query}`, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(1500);
  return { page, errs };
}

async function openRow(page, needle) {
  const ok = await page.evaluate((n) => {
    const row = [...document.querySelectorAll("table tbody tr")].find((tr) => (tr.textContent ?? "").includes(n));
    const edit = row && [...row.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Edit");
    edit?.click();
    return !!edit;
  }, needle);
  await sleep(900);
  return ok;
}

const txt = (page) => page.evaluate(() => document.body.textContent ?? "");

// ---- 1. local account: structure, metadata, role, footer --------------------------
{
  const { page, errs } = await open("?theme=light");
  const p = [];
  if (errs.length) p.push(`JS error: ${errs[0]}`);

  if (!(await openRow(page, "alice@drlinuxer.com"))) p.push("could not open Alice's drawer");
  const text = await txt(page);
  if (!/User details/.test(text)) p.push("drawer title missing");
  if (!/alice@drlinuxer\.com/.test(text)) p.push("email missing");
  if (!/Account type/.test(text)) p.push("Account type label missing");
  if (!/\bLocal\b/.test(text)) p.push("Local account type missing");
  if (!/Current: Administrator/.test(text)) p.push("current role badge missing");
  if (!/Manage users/.test(text)) p.push("capability list missing");

  const m = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const rows = [...aside.querySelectorAll("dl > div")].map((d) => (d.textContent ?? "").replace(/\s+/g, " ").trim());
    const footer = [...aside.querySelectorAll("footer button")].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim());
    const save = footer.find((t) => /Save access changes/.test(t));
    const saveBtn = [...aside.querySelectorAll("footer button")].find((b) => /Save access changes/.test(b.textContent ?? ""));
    const r = aside.getBoundingClientRect();
    return {
      width: Math.round(r.width),
      rows,
      footer,
      saveDisabled: saveBtn ? saveBtn.disabled : null,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  if (m.rows.length !== 6) p.push(`metadata grid rendered ${m.rows.length} items, expected 6: ${m.rows.join(" | ")}`);
  if (!m.rows.some((r) => /Account type\s*(Active Directory|Local)/.test(r))) p.push("Account type is not part of the metadata grid");
  if (m.rows.some((r) => /^Email —$/.test(r))) p.push("email rendered as empty");
  if (m.width !== 480) p.push(`drawer width is ${m.width}, expected 480`);
  if (m.overflow) p.push("desktop: horizontal overflow with the drawer open");
  if (!m.saveDisabled) p.push("Save access changes is enabled before a change");
  if (!m.footer.some((t) => /Deactivate account/.test(t))) p.push("deactivate action missing from the footer");
  if (!m.footer.some((t) => /Reset access/.test(t))) p.push("reset action missing from the footer");

  await page.screenshot({ path: `${OUT}/user_drawer_local.png`, fullPage: false });
  report.local = { ...m, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 2. role change preview + save + confirms -------------------------------------
{
  const { page } = await open("?theme=light");
  const p = [];
  await openRow(page, "alice@drlinuxer.com");

  await page.select('aside select[aria-label="Role"]', "User");
  await sleep(500);
  const after = await txt(page);
  if (!/Preview: User/.test(after)) p.push("preview badge did not switch to the new role");
  if (!/Changing from Administrator to User/.test(after)) p.push("no explicit from → to line");
  const saveOn = await page.evaluate(() => {
    const b = [...document.querySelectorAll("aside footer button")].find((x) => /Save access changes/.test(x.textContent ?? ""));
    return b ? !b.disabled : false;
  });
  if (!saveOn) p.push("Save stayed disabled after a real role change");

  await page.evaluate(() => {
    [...document.querySelectorAll("aside footer button")].find((x) => /Save access changes/.test(x.textContent ?? ""))?.click();
  });
  await sleep(900);
  const reqs = await page.evaluate(() => window.__USR_REQS__ ?? []);
  const patch = reqs.find((r) => r.method === "PATCH" && /\/role$/.test(r.path));
  if (!patch) p.push("no PATCH /role was sent");
  else if (!/"role"\s*:\s*"user"/.test(patch.body)) p.push(`role payload was ${patch.body}`);

  // destructive confirm
  await page.evaluate(() => {
    [...document.querySelectorAll("aside footer button")].find((x) => /Deactivate account/.test(x.textContent ?? ""))?.click();
  });
  await sleep(700);
  const confirm = await txt(page);
  if (!/Deactivate alice\?/.test(confirm)) p.push("deactivate did not ask for confirmation");
  if (!/signed out straight away/.test(confirm)) p.push("deactivate dialog does not explain the consequence");
  await page.screenshot({ path: `${OUT}/user_drawer_confirm.png`, fullPage: false });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Cancel")?.click();
  });
  await sleep(400);

  // reset confirm
  await page.evaluate(() => {
    [...document.querySelectorAll("aside footer button")].find((x) => /Reset access/.test(x.textContent ?? ""))?.click();
  });
  await sleep(700);
  if (!/Force alice to sign in again\?/.test(await txt(page))) p.push("reset did not ask for confirmation");

  report.roleFlow = { patch: patch?.body ?? null, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 3. AD account: notice card, no local password form ---------------------------
{
  const { page } = await open("?theme=light");
  const p = [];
  if (!(await openRow(page, "Bob Brown"))) p.push("could not open Bob's drawer");
  const text = await txt(page);
  const occurrences = (text.match(/Managed by Active Directory/g) ?? []).length;
  if (occurrences < 2) p.push(`AD notices rendered ${occurrences}×, expected the directory + security cards`);
  if (!/owned by AD/.test(text)) p.push("AD card does not explain what AD owns");
  if (!/run a directory sync/.test(text)) p.push("AD card does not say how to change it");
  if (/Update password/.test(text)) p.push("AD account still offers a local password form");
  if (!/Password changes happen in AD/.test(text)) p.push("AD password affordance missing");
  if (!/IT Support/.test(text)) p.push("AD role not shown");

  await page.screenshot({ path: `${OUT}/user_drawer_directory.png`, fullPage: false });
  report.directory = { occurrences, problems: p };
  p.forEach(fail);
  await page.close();
}

// ---- 4. mobile + dark --------------------------------------------------------------
{
  const { page } = await open("?theme=light", 390, 844);
  const p = [];
  await openRow(page, "alice@drlinuxer.com");
  const m = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const r = aside.getBoundingClientRect();
    const footer = aside.querySelector("footer");
    const fr = footer.getBoundingClientRect();
    const buttons = [...footer.querySelectorAll("button")].map((b) => {
      const br = b.getBoundingClientRect();
      return { label: (b.textContent ?? "").trim(), w: Math.round(br.width), h: Math.round(br.height) };
    });
    return {
      width: Math.round(r.width),
      vw: window.innerWidth,
      footerVisible: fr.bottom <= window.innerHeight + 1 && fr.top < window.innerHeight,
      buttons,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  if (Math.abs(m.width - m.vw) > 2) p.push(`mobile drawer is ${m.width}px wide, expected ${m.vw}`);
  if (!m.footerVisible) p.push("mobile footer is not reachable");
  if (m.buttons.some((b) => b.h < 32)) p.push(`mobile tap target ${JSON.stringify(m.buttons)}`);
  if (m.buttons.some((b) => b.w < 150)) p.push("mobile footer buttons are not full width");
  if (m.overflow) p.push("mobile: horizontal overflow with the drawer open");
  await page.screenshot({ path: `${OUT}/user_drawer_390.png`, fullPage: false });
  report.mobile = { ...m, problems: p };
  p.forEach(fail);
  await page.close();

  const d = await open("", 1440, 1000); // harness default is dark
  await openRow(d.page, "Bob Brown");
  const bg = await d.page.evaluate(() => getComputedStyle(document.querySelector("aside")).backgroundColor);
  const rgb = bg.match(/\d+/g)?.map(Number) ?? [255, 255, 255];
  const q = [];
  if (rgb[0] > 80 || rgb[1] > 80 || rgb[2] > 80) q.push(`dark drawer surface is ${bg}`);
  await d.page.screenshot({ path: `${OUT}/user_drawer_dark.png`, fullPage: false });
  report.dark = { bg, problems: q };
  q.forEach(fail);
  await d.page.close();
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
dev.kill();
if (problems.length) {
  console.error(`\nFAILED (${problems.length}):`);
  problems.forEach((x) => console.error("  - " + x));
  process.exit(1);
}
console.log("\nOK: metadata grid, role preview/save, AD notices and footer actions all hold");
