import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 });
await sleep(1500);

// login
await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 });
  await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 });
  await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(3000);
}
await page.evaluate(() => { location.hash = "#/chat"; });
await sleep(2500);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/chat_review_empty.png" });
console.log("EMPTY captured");

// Send a question to see the populated state
const ta = await page.$("textarea");
if (ta) {
  await ta.click();
  await ta.type("How do I check Linux server health?");
  await page.keyboard.press("Enter");
  await sleep(28000);
}
await page.screenshot({ path: "D:/ragchatbot/docs/qa/chat_review_active.png" });
console.log("ACTIVE captured");
await browser.close();
