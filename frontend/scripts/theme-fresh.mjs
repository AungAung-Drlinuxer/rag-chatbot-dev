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
  await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(800);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(2500);
  const beforeDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("initial dark:", beforeDark);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-fresh-1-initial.png" });
  // Click Light
  const r1 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const light = btns.find((b) => b.textContent.trim() === "Light");
    if (light) { light.click(); return true; }
    return false;
  });
  console.log("clicked Light:", r1);
  await sleep(500);
  // Click Save
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterLight = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Light+Save (should be false):", afterLight);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-fresh-2-light.png" });
  // Click Dark
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.trim().startsWith("Save changes"));
    if (save) save.click();
  });
  await sleep(3000);
  const afterDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  console.log("after Dark+Save (should be true):", afterDark);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/test-fresh-3-dark.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }