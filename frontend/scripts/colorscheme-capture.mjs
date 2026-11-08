// capture both themes
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
  // DARK
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v0.21.21-dash-dark.png" });
  // Go to settings
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v0.21.21-settings-dark.png" });
  // Click Light
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) light.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3500);
  // LIGHT
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(2500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v0.21.21-dash-light.png" });
  // Users light
  await page.evaluate(() => { window.location.hash = "#/users"; });
  await sleep(2500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/v0.21.21-users-light.png" });
  console.log("all captured");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }