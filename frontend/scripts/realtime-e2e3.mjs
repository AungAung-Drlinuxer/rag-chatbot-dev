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
  await sleep(500);
  await page.type('input[type="text"]', "ith@dmin", { delay: 15 });
  await page.type('input[type="password"]', "Pwint@160320", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(2500);
  await page.focus("textarea");
  await page.keyboard.type("hello", { delay: 5 });
  await page.keyboard.press("Enter");
  await sleep(12000);
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  console.log("PAGE TEXT:");
  console.log(txt);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/realtime-3.png" });
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }