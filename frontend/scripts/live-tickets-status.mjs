// LIVE verify: status segmented control instant-save on production
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message.slice(0, 100)));
  await page.setViewport({ width: 1500, height: 950 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector("#login-username");
  await page.type("#login-username", process.env.VERIFY_USER);
  await page.type("#login-password", process.env.VERIFY_PASS);
  await page.keyboard.press("Enter");
  await sleep(3000);
  await page.evaluate(() => { [...document.querySelectorAll("button")].find(x=>/^tickets$/i.test((x.textContent||"").trim()))?.click(); });
  await sleep(6000);
  await page.evaluate(() => { [...document.querySelectorAll("tbody tr td button")].find(b => /^ITHD-\d+/.test((b.textContent||"").trim()))?.click(); });
  await sleep(3000);
  const seg = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
    if (!h) return { found: false };
    const btns = [...h.parentElement.querySelectorAll("button")].map(b => (b.textContent||"").trim());
    return { found: true, btns, active: h.parentElement.querySelector('[aria-pressed="true"]')?.textContent?.trim() };
  });
  console.log("LIVE segmented control:", JSON.stringify(seg));
  if (seg.found) {
    const target = seg.btns.find(b => b !== seg.active);
    await page.evaluate((t) => {
      const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
      [...h.parentElement.querySelectorAll("button")].find(b => (b.textContent||"").trim() === t).click();
    }, target);
    let toast = null;
    for (let i = 0; i < 40; i++) {
      toast = await page.evaluate(() => document.querySelector("[role=status]")?.textContent || null);
      if (toast) break;
      await sleep(250);
    }
    const nowActive = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
      return h?.parentElement.querySelector('[aria-pressed="true"]')?.textContent?.trim();
    });
    console.log(`clicked "${target}" -> toast "${toast}" | active now: "${nowActive}"`);
    // restore original status
    await page.evaluate((t) => {
      const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
      [...h.parentElement.querySelectorAll("button")].find(b => (b.textContent||"").trim() === t).click();
    }, seg.active);
    await sleep(2000);
    const restored = await page.evaluate(() => {
      const h = [...document.querySelectorAll("h3")].find(x => /click to change/i.test(x.textContent||""));
      return h?.parentElement.querySelector('[aria-pressed="true"]')?.textContent?.trim();
    });
    console.log("restored to:", restored);
  }
  await page.screenshot({ path: "D:/ragchatbot/verify_live_tickets02.png" });
  console.log("pageerrors:", errs.length ? errs : "none");
} catch (e) { console.log("FAIL", e.message); } finally { await browser.close(); }
