// Screenshot the General section
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
  await page.goto("http://localhost:1420/settings", { waitUntil: "networkidle0" });
  await sleep(400);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-general.png" });
  // try clicking dark mode toggle
  const darkBtn = await page.$("text=Dark");
  if (darkBtn) { await darkBtn.click(); await sleep(400); await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/settings-general-dark.png" }); }
  console.log("captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }