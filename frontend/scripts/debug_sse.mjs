import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();


const samples = [];
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
// sample the tracker detail line every 2s to see event arrival timeline
for (let t = 0; t < 10; t++) {
  await sleep(2000);
  const d = await page.evaluate(() => {
    const tracker = document.querySelector("aside [data-testid='rag-pipeline-tracker']");
    if (!tracker) return null;
    const lines = tracker.innerText.split("\n");
    return { lastLine: lines[lines.length - 1], ms: (tracker.innerText.match(/(\d+\.\d)s/) || [])[1] };
  });
  console.log("T+" + ((t + 1) * 2) + "s:", JSON.stringify(d));
}

const res = await page.evaluate(() => {
  const tracker = document.querySelector("aside [data-testid='rag-pipeline-tracker']");
  return tracker ? { rows: [...tracker.querySelectorAll("ol > li")].map((li) => ({
    label: li.querySelector("span.flex-1")?.textContent,
    ms: li.querySelector("span.font-mono")?.textContent ?? "NONE",
  })), detail: tracker.innerText.split("\n").slice(-2)[0] } : { present: false };
});
console.log("RESULT:", JSON.stringify(res, null, 1));
console.log("SSE chunks received:", sseChunks.length);
console.log("SSE raw (first 800):", sseChunks.join("").slice(0, 800));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/pipeline_debug.png" });
await browser.close();