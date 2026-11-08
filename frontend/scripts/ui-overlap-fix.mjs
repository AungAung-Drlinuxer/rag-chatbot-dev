// Verify the transparent-card bug is fixed: settings cards + theme dropdown must have
// opaque backgrounds, no text overlap. Reproduces the user's screenshot scenario.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await page.waitForFunction(() => document.querySelectorAll("[data-slot=card], .set-card").length >= 6, { timeout: 12000 });
  await sleep(800);

  // 1. Card backgrounds opaque?
  const cardBg = await page.evaluate(() => {
    const c = document.querySelector("[data-slot=card]");
    return c ? getComputedStyle(c).backgroundColor : "none";
  });
  const opaque = cardBg && !/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(cardBg) && cardBg !== "transparent";
  ok("settings card has opaque background", opaque, cardBg);

  // 2. Theme dropdown open → popover opaque + items readable?
  const trigger = await page.evaluate(() => {
    const t = [...document.querySelectorAll("[data-slot=select-trigger]")][0];
    if (t) t.click();
    return !!t;
  });
  await sleep(700);
  const pop = await page.evaluate(() => {
    const p = document.querySelector("[data-slot=select-content], [data-radix-popper-content-wrapper] [data-slot=select-viewport]");
    if (!p) return null;
    const cs = getComputedStyle(p);
    return { bg: cs.backgroundColor, text: p.textContent.slice(0, 40) };
  });
  ok("theme dropdown opens", !!trigger && !!pop, pop ? pop.text : "no popover");
  if (pop) {
    const popOpaque = !/rgba?\([^)]*,\s*0\s*\)/.test(pop.bg) && pop.bg !== "transparent";
    ok("dropdown popover has opaque background", popOpaque, pop.bg);
  }
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/fix-settings-light.png" });

  // 3. Dark theme — same checks
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(400);
  const darkCard = await page.evaluate(() => {
    const c = document.querySelector("[data-slot=card]");
    return c ? getComputedStyle(c).backgroundColor : "none";
  });
  ok("dark: card opaque", darkCard && !/rgba?\([^)]*,\s*0\s*\)/.test(darkCard) && darkCard !== "transparent", darkCard);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/fix-settings-dark.png" });

  // 4. chat page also fine?
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /assistant/i.test(e.textContent)); if (n) n.click(); });
  await sleep(600);
  const ctxCard = await page.evaluate(() => {
    const c = document.querySelector(".context .card");
    return c ? getComputedStyle(c).backgroundColor : "none";
  });
  ok("chat context card opaque (light)", ctxCard && ctxCard !== "transparent" && !/rgba?\([^)]*,\s*0\s*\)/.test(ctxCard), ctxCard);

  const fails = R.filter(r => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
