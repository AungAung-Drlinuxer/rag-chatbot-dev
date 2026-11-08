// Resize-stability audit: log in once, then test 3 viewport widths for
// horizontal overflow, avatar rendering, and composer visibility.
import puppeteer from "puppeteer-core";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = "http://127.0.0.1:4173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev");
  await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });

  // send one message so we have user+assistant rows with avatars
  await page.type('textarea[placeholder^="Ask about"]', "Database connection timeout");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  await sleep(6000);

  for (const w of [1366, 1024, 800]) {
    await page.setViewport({ width: w, height: 900 });
    await sleep(900);
    const r = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowX = doc.scrollWidth > doc.clientWidth + 2;
      const aA = !!document.querySelector(".avatar.assistant");
      const aU = !!document.querySelector(".avatar.user");
      const composer = (() => { const c = document.querySelector(".composer"); if (!c) return false; const b = c.getBoundingClientRect(); return b.width > 100 && b.bottom <= innerHeight + 2; })();
      const chatW = document.querySelector(".chat")?.getBoundingClientRect().width || 0;
      return { overflowX, aA, aU, composer, chatW: Math.round(chatW), body: doc.scrollWidth + "x" + doc.scrollHeight };
    });
    console.log(`${w}px -> overflowX=${r.overflowX} avatarAssistant=${r.aA} avatarUser=${r.aU} composerVisible=${r.composer} chatWidth=${r.chatW}`);
    if (w === 800) {
      const ctxHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".context") || document.body).display === "none");
      const sbHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".sidebar") || document.body).display !== "block" ? true : true);
      console.log(`  800px extra: contextHidden=${ctxHidden}`);
    }
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/resize-${w}.png` });
  }
  console.log("RESIZE_AUDIT_DONE");
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
