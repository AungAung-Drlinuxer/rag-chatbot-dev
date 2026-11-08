// Full UI audit: every page, every mode.
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await sleep(600);
  // login screenshot
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-01-login.png" });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  // send a message so chat has content
  await page.type('textarea[placeholder^="Ask about"]', "VPN connection issue help");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  for (let i = 0; i < 25; i++) {
    const done = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".msg-row.assistant .bubble")].pop();
      return b && b.textContent && b.textContent.length > 60;
    });
    if (done) break;
    await sleep(1500);
  }
  await sleep(1000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-02-chat-light.png" });
  // dark chat
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(600);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-03-chat-dark.png" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await sleep(300);
  // knowledge
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(2000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-04-knowledge.png" });
  // settings
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  await sleep(2000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-05-settings.png" });
  // dark settings
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(600);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-06-settings-dark.png" });
  // escalations
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /escalations/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-07-escalations.png" });
  console.log("AUDIT_CAPTURE_DONE");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }