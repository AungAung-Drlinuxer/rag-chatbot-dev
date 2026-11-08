// Live web demo — drive the containerized frontend (localhost:18080) login -> chat.
import puppeteer from "puppeteer-core";

const BASE = "http://localhost:18080";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "C:/Users/aungaung/it-help-chatbot/docs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860 });

  // 1) login screen
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  console.log("STEP1: login form visible");
  await page.type('input[placeholder="Username"]', "dev");
  await page.type('input[placeholder="Password"]', "dev");
  await page.click('button.send, button[type="submit"]');
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  console.log("STEP2: LOGIN SUCCESS (main app visible)");
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/live-web-login.png` });

  // 2) chat
  await page.type('textarea[placeholder*="Ask about"]', "How do I resolve a PostgreSQL connection timeout?");
  await page.keyboard.press("Enter");
  console.log("STEP3: query sent (streaming deepseek answer...)");
  await sleep(16000); // reasoning + answer streaming
  const text = await page.evaluate(() => document.body.innerText);
  console.log("STEP4: answer snippet ->", text.replace(/\s+/g, " ").slice(0, 300));
  await page.screenshot({ path: `${OUT}/live-web-chat.png` });
  console.log("RESULT: DONE");
  await browser.close();
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
