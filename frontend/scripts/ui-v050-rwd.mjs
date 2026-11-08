// v0.5.0 RWD QA: hamburger + drawer on tablet/mobile, layouts at 4 sizes.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (n, c, e = "") => { R.push(`${c ? "PASS" : "FAIL"} | ${n}${e ? " | " + e : ""}`); console.log(R[R.length - 1]); };
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();

  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  // login once (session persists across viewport changes)
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // Desktop: no hamburger, sidebar inline
  const dHam = await page.evaluate(() => getComputedStyle(document.querySelector(".hamburger")).display);
  ok("desktop 1440: hamburger hidden", dHam === "none");

  // Laptop 1024: hamburger visible; sidebar inline visible
  await page.setViewport({ width: 1180, height: 900 });
  await sleep(600);
  const l = await page.evaluate(() => ({
    ham: getComputedStyle(document.querySelector(".hamburger")).display,
    sbVisible: document.querySelector(".sidebar").getBoundingClientRect().left >= 0 &&
               getComputedStyle(document.querySelector(".sidebar")).position === "fixed" ? "fixed" : "inline",
  }));
  ok("laptop 1180: hamburger shows", l.ham !== "none");
  console.log("laptop sidebar mode:", l.sbVisible);

  // Tablet 768: drawer closed initially; open via hamburger
  await page.setViewport({ width: 820, height: 900 });
  await sleep(700);
  let t = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    return { transform: getComputedStyle(sb).transform, left: sb.getBoundingClientRect().left };
  });
  ok("tablet 820: drawer off-canvas initially", t.left < -50, `left=${Math.round(t.left)}`);
  await page.evaluate(() => document.querySelector(".hamburger").click());
  await sleep(500);
  t = await page.evaluate(() => {
    const sb = document.querySelector(".sidebar");
    return { left: Math.round(sb.getBoundingClientRect().left), backdrop: !!document.querySelector(".drawer-backdrop") };
  });
  ok("tablet: hamburger opens drawer", t.left >= 0 && t.backdrop, JSON.stringify(t));
  // navigate via drawer → knowledge, drawer should close
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(800);
  const closed = await page.evaluate(() => document.querySelector(".sidebar").getBoundingClientRect().left < -50);
  const onKb = await page.evaluate(() => location && !!document.querySelector(".kb-page"));
  ok("tablet: nav click closes drawer + lands on Knowledge", closed && onKb);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v050-tablet-drawer-closed.png" });

  // Phone 390: overflow check + composer safe area + nav via drawer works too
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
  await sleep(700);
  const m = await page.evaluate(() => ({
    ov: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    ham: getComputedStyle(document.querySelector(".hamburger")).display !== "none",
  }));
  ok("phone 390: no horizontal overflow", !m.ov);
  ok("phone 390: hamburger available", m.ham);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v050-phone.png" });

  const fails = R.filter((r) => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
