// Visual check: login page with illustration — desktop + tablet + mobile
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  for (const [w, h, name] of [[1440, 900, "desktop"], [1024, 768, "tablet"], [390, 844, "mobile"]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle2", timeout: 30000 });
    await sleep(800);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/login-${name}.png` });
    console.log(name, "captured");
  }
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }