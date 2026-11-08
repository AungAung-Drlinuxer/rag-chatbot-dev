// Probe layout dimensions
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0", timeout: 20000 });
  await page.type("#u", "dev"); await page.type("#p", "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 20000 });
  await sleep(2000);
  const m = await page.evaluate(() => {
    const layout = document.querySelector(".layout");
    const sb = document.querySelector(".sidebar");
    const lp = document.querySelector(".left-panel");
    const ch = document.querySelector(".chat");
    const cs = (el) => el ? {
      display: getComputedStyle(el).display,
      w: el.getBoundingClientRect().width,
      h: el.getBoundingClientRect().height,
      x: el.getBoundingClientRect().x,
    } : null;
    return {
      layoutDisplay: layout && getComputedStyle(layout).display,
      layoutCols: layout && getComputedStyle(layout).gridTemplateColumns,
      layoutWH: layout ? `${layout.getBoundingClientRect().width}x${layout.getBoundingClientRect().height}` : null,
      sb: cs(sb), lp: cs(lp), ch: cs(ch),
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/chatlayout-debug.png" });
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }