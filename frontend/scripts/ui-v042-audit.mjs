// v0.4.2 full-app visual audit: all pages, light+dark, screenshots.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await sleep(500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v042-login.png" });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  await sleep(800);
  // chat + send a message
  await page.type('textarea[placeholder^="Ask about"]', "VPN keeps dropping");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  for (let i = 0; i < 20; i++) {
    const len = await page.evaluate(() => ([...document.querySelectorAll(".msg-row.assistant .bubble")].pop() || {}).textContent?.length || 0);
    if (len > 40) break;
    await sleep(1500);
  }
  await sleep(1200);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v042-chat.png" });
  for (const nav of ["knowledge", "escalations", "settings"]) {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".navitem")].find((e) => e.textContent.toLowerCase().includes(n)); if (el) el.click(); }, nav);
    await sleep(1800);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/v042-${nav}.png` });
  }
  // dark settings
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v042-settings-dark.png" });
  console.log("SHOTS_DONE");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
