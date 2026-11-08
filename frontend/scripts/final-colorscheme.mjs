// capture the new theme
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(800);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  // Force dark theme
  await page.evaluate(() => {
    localStorage.setItem("ith.dark", "1");
    document.documentElement.setAttribute("data-theme", "dark");
    document.documentElement.classList.add("dark");
  });
  await sleep(500);
  // Dashboard in dark theme
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(2000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-v0.21.21-dark.png" });
  // Switch to light
  await page.evaluate(() => {
    localStorage.setItem("ith.dark", "0");
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.classList.remove("dark");
  });
  await sleep(500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/final-v0.21.21-light.png" });
  console.log("done");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }