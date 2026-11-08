import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox", "--disk-cache-size=1", "--disable-application-cache"]
});
const page = await browser.newPage();
await page.setCacheEnabled(false);
await page.setViewport({ width: 1600, height: 900 });
await page.goto("https://chat.drlinuxer.com/#/login", { waitUntil: "networkidle2", timeout: 45000 });
await sleep(1500);
await page.type('input[name="username"]', "ui-reviewer");
await page.type('input[name="password"]', "UiReview!x7");
await page.click('button[type="submit"]');
await sleep(6000);
await page.goto("https://chat.drlinuxer.com/#/articles", { waitUntil: "networkidle2", timeout: 45000 });
await sleep(5000);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_articles.png" });
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const b = btns.find(b => /domains|routing/i.test(b.textContent || ""));
  if (b) { b.click(); return true; }
  return false;
});
console.log("domains tab clicked:", clicked);
await sleep(4000);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_domains.png" });
await page.evaluate(() => {
  const els = [...document.querySelectorAll("div")].filter(d => {
    const s = getComputedStyle(d); return (s.overflowY === "auto" || s.overflowY === "scroll") && d.scrollHeight > d.clientHeight + 100;
  });
  els.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
  if (els[0]) els[0].scrollTop = els[0].scrollHeight * 0.6;
});
await sleep(1200);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_lower.png" });
console.log("kb captured (3)");
await browser.close();
