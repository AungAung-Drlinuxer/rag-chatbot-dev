// capture dashboard
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.goto("http://localhost:1420/", { waitUntil: "networkidle0" });
  // login as dev via api (write to localStorage)
  await page.evaluate(() => localStorage.clear());
  // wait briefly for page
  await sleep(800);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/dash-after.png" });
  console.log("captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }