// Responsive proof for the Login page: capture every breakpoint that changes layout,
// in both themes, and assert the things that actually break (horizontal overflow,
// brand column visibility, form width cap, tap-target size).
//
// Usage (dev server only): node scripts/login_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 5233;
const BASE = `http://localhost:${PORT}/login-harness.html`;
const OUT = "../docs/qa";
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "ignore" });
const reachable = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error("login harness not reachable"); }
await sleep(1500);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const VIEWPORTS = [
  { name: "mobile_320", width: 320, height: 720 },
  { name: "mobile_390", width: 390, height: 844 },
  { name: "tablet_768", width: 768, height: 1024 },
  { name: "laptop_1280", width: 1280, height: 800 },
  { name: "desktop_1920", width: 1920, height: 1080 },
];

const report = { problems: [], shots: [], checks: {} };

// The SSO button only exists when a realm is configured, so it gets its own capture and
// its own assertions (presence, 40px tap target, and that it is NOT there by default).
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?theme=light&logo=1&sso=1`, { waitUntil: "networkidle2" });
  await sleep(700);
  const m = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => /sign in with sso/i.test(b.textContent || ""));
    const r = btn?.getBoundingClientRect();
    return { found: !!btn, h: r ? Math.round(r.height) : 0, text: (btn?.textContent || "").trim() };
  });
  report.sso = m;
  if (!m.found) report.problems.push("sso: the SSO button did not render when a realm is configured");
  if (m.h && m.h < 40) report.problems.push(`sso: button shorter than 40px (${m.h})`);
  await page.screenshot({ path: `${OUT}/login_sso.png`, fullPage: false });
  report.shots.push(`${OUT}/login_sso.png`);

  await page.goto(`${BASE}?theme=light&logo=1`, { waitUntil: "networkidle2" });
  await sleep(400);
  const absent = await page.evaluate(
    () => ![...document.querySelectorAll("button")].some((b) => /sign in with sso/i.test(b.textContent || "")),
  );
  if (!absent) report.problems.push("sso: the SSO button renders even though no realm is configured");
  await page.close();
}

for (const theme of ["light", "dark"]) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));
    await page.goto(`${BASE}?theme=${theme}&logo=1`, { waitUntil: "networkidle2" });
    await sleep(600);

    const m = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const rows = [...document.querySelectorAll("h1, h2, label, input, button")];
      const input = q("#login-username");
      const submit = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Sign in"));
      const brand = document.querySelector("section");
      const card = q("form")?.closest("div.rounded-3xl") || q("form")?.parentElement;
      const rect = (el) => { const r = el?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) } : null; };
      return {
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        brandVisible: brand ? getComputedStyle(brand).display !== "none" : false,
        brandRect: rect(brand),
        cardRect: rect(card),
        inputRect: rect(input),
        submitRect: rect(submit),
        tinyTargets: rows
          .map((el) => ({ tag: el.tagName, text: (el.textContent || "").trim().slice(0, 24), r: el.getBoundingClientRect() }))
          .filter((x) => x.r.width > 0 && (x.r.height < 28) && (x.tag === "BUTTON" || x.tag === "INPUT")).length,
        h1: q("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        logoImgs: document.querySelectorAll('img[alt*="logo" i]').length,
        illustration: !!document.querySelector('img[alt*="illustration" i], img[src*="login-illustration"]'),
      };
    });

    const key = `${theme}_${vp.name}`;
    report.checks[key] = m;
    if (m.scrollW > m.clientW + 1) report.problems.push(`${key}: horizontal overflow (${m.scrollW} > ${m.clientW})`);
    if (vp.width >= 1024 && !m.brandVisible) report.problems.push(`${key}: brand column hidden at desktop width`);
    if (vp.width < 1024 && m.brandVisible) report.problems.push(`${key}: brand column still shown on a narrow viewport`);
    if (m.cardRect && m.cardRect.w > 560) report.problems.push(`${key}: sign-in card too wide (${m.cardRect.w}px)`);
    if (m.inputRect && m.inputRect.h < 40) report.problems.push(`${key}: input shorter than 40px (${m.inputRect.h})`);
    if (m.submitRect && m.submitRect.h < 40) report.problems.push(`${key}: submit shorter than 40px (${m.submitRect.h})`);
    if (m.logoImgs < 1) report.problems.push(`${key}: branding logo did not render`);
    if (jsErrors.length) report.problems.push(`${key}: JS error ${jsErrors[0]}`);

    const file = `${OUT}/login_${key}.png`;
    await page.screenshot({ path: file, fullPage: vp.width < 1024 });
    report.shots.push(file);
    await page.close();
  }
}

// Fallback-logo state (no uploaded logo) at one size, to prove the monogram path.
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}?theme=light&logo=0`, { waitUntil: "networkidle2" });
await sleep(500);
report.checks.fallback_logo = await page.evaluate(() => ({
  monogram: [...document.querySelectorAll("div")].some((d) => d.textContent?.trim() === "iTH"),
  logoImgs: document.querySelectorAll('img[alt*="logo" i]').length,
}));
if (!report.checks.fallback_logo.monogram) report.problems.push("fallback: monogram mark missing when no logo is uploaded");
await page.screenshot({ path: `${OUT}/login_mobile_390_fallback.png`, fullPage: true });
await page.close();

// Error state (keeps the alert inside the card, above the button).
const errPage = await browser.newPage();
await errPage.setViewport({ width: 390, height: 844 });
await errPage.goto(`${BASE}?theme=light&logo=1`, { waitUntil: "networkidle2" });
await sleep(400);
await errPage.type("#login-username", "aung");
await errPage.type("#login-password", "x");
await errPage.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim().startsWith("Sign in"));
  b?.click();
});
await sleep(500);
const errInfo = await errPage.evaluate(() => ({
  alert: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
report.checks.error_state = errInfo;
if (errInfo.overflow) report.problems.push("error_state: horizontal overflow");
await errPage.screenshot({ path: `${OUT}/login_mobile_390_error.png`, fullPage: true });
await errPage.close();

await browser.close();
dev.kill();

console.log(JSON.stringify(report, null, 2));
if (report.problems.length) {
  console.log(`\nFAILED (${report.problems.length}):`);
  for (const p of report.problems) console.log(`  - ${p}`);
  process.exitCode = 1;
} else {
  console.log("\nOK: every breakpoint rendered without overflow, with branding and accessible targets.");
}
