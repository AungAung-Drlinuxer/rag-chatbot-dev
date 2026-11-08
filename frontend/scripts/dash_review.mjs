import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1200"],
  defaultViewport: { width: 1600, height: 1200 },
});
const page = await browser.newPage();
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);
await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 }); await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(4000);
}
await page.evaluate(() => { location.hash = "#/dashboard"; });
await sleep(5000);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/dash_review_top.png" });
await page.evaluate(() => { const el = document.querySelector("main") || document.scrollingElement; el.scrollTop = 900; });
await sleep(1200);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/dash_review_mid.png" });
await page.evaluate(() => { const el = document.querySelector("main") || document.scrollingElement; el.scrollTop = el.scrollHeight; });
await sleep(1200);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/dash_review_bottom.png" });

const audit = await page.evaluate(() => {
  const txt = document.body.innerText;
  const nums = (txt.match(/[—–]|\bn\/a\b|\bNaN\b|\b0\.0%\b|\bundefined\b|null\b/g) || []);
  return {
    suspicious: nums.slice(0, 20),
    headingCount: document.querySelectorAll("h1,h2,h3").length,
    cardCount: document.querySelectorAll('[class*="rounded-2xl"],[class*="rounded-xl"]').length,
    textLen: txt.length,
    sample: txt.slice(0, 1400),
  };
});
console.log(JSON.stringify(audit, null, 1));
await browser.close();
