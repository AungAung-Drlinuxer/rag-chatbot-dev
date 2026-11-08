import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
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

// find the real scroll container and stitch the page by scrolling it
const info = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll("div")].filter(
    (d) => d.scrollHeight > d.clientHeight + 100 && getComputedStyle(d).overflowY !== "visible"
  );
  const el = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  return { found: !!el, sh: el?.scrollHeight, ch: el?.clientHeight };
});
console.log("SCROLLER:", JSON.stringify(info));

const total = Math.ceil((info.sh || 1000) / 900);
for (let i = 0; i < Math.min(total, 4); i += 1) {
  await page.evaluate((y) => {
    const candidates = [...document.querySelectorAll("div")].filter(
      (d) => d.scrollHeight > d.clientHeight + 100 && getComputedStyle(d).overflowY !== "visible"
    );
    const el = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.scrollTop = y;
  }, i * 900);
  await sleep(1000);
  await page.screenshot({ path: `D:/ragchatbot/docs/qa/dash_sec${i}.png` });
  console.log("captured sec" + i);
}

// gather the lower-half text so the review can cite real values
const lower = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
console.log("BOTTOM-TEXT:", lower.slice(-1900));
await browser.close();
