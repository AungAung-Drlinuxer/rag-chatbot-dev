// full E2E with screenshots
import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"],
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
  await page.setViewport({ width: 1440, height: 900 });
  // 1. LOGIN
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(800);
  console.log("1. login page URL:", page.url());
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-1-login.png" });
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  console.log("2. after login URL:", page.url());
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-2-after-login.png" });
  // 2. DASHBOARD
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(2000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-3-dashboard.png" });
  // 3. SETTINGS — apply dark → light transition
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  const beforeDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("3. settings initial dark:", beforeDark);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-4-settings-before.png" });
  // 4. Switch to LIGHT
  const clickedLight = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) { light.click(); return true; }
    return false;
  });
  console.log("4. clicked Light:", clickedLight);
  await sleep(400);
  const afterClick = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("5. dark class after Light click:", afterClick);
  // 5. Save
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("6. dark class after Save:", afterSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-5-settings-after-light.png" });
  // 6. Switch back to DARK
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(400);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterDarkSave = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("7. dark class after Dark+Save:", afterDarkSave);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-6-settings-after-dark.png" });
  // 7. USERS page
  await page.evaluate(() => { window.location.hash = "#/users"; });
  await sleep(2500);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-7-users.png" });
  console.log("ALL DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }