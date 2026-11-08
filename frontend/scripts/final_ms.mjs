import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto("https://chat.drlinuxer.com/", { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
await sleep(1500);

const inputs = await page.$$("input");
await inputs[0].type("ui-reviewer");
await inputs[1].type("UiReview!x72");
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => /sign in|login/i.test(b.textContent || ""));
  btn?.click();
});
await sleep(3500);

await page.type("textarea", "How do I restart the nginx service on a Linux server?");
await page.keyboard.press("Enter");
await sleep(22000);

const res = await page.evaluate(() => {
  const tracker = document.querySelector("aside [data-testid='rag-pipeline-tracker']");
  if (!tracker) return { present: false };
  const rows = [...tracker.querySelectorAll("ol > li")];
  const data = rows.map((li) => {
    const msEl = li.querySelector("span.font-mono");
    const labelEl = li.querySelector("span.flex-1");
    return { label: labelEl?.textContent, ms: msEl?.textContent ?? "NONE" };
  });
  return { present: true, data, checks: (tracker.innerText.match(/✓/g) || []).length };
});
console.log("RESULT:", JSON.stringify(res, null, 1));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/pipeline_ms_final.png" });
await browser.close();