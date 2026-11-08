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

await page.evaluate(() => { location.hash = "#/login"; });
await sleep(1200);
const inputs = await page.$$("input");
if (inputs.length >= 2) {
  await inputs[0].click({ clickCount: 3 });
  await inputs[0].type("ui-reviewer");
  await inputs[1].click({ clickCount: 3 });
  await inputs[1].type("UiReview!x72");
  await page.keyboard.press("Enter");
  await sleep(3500);
}
await page.evaluate(() => { location.hash = "#/chat"; });
await sleep(3000);
// start a brand-new conversation so the empty state is clean
await page.evaluate(() => window.dispatchEvent(new CustomEvent("ith:new-chat")));
await sleep(2500);
await page.screenshot({ path: "D:/ragchatbot/docs/qa/chat_after_empty.png" });
console.log("AFTER-EMPTY captured");

const ta = await page.$("textarea");
if (ta) {
  await ta.click();
  await ta.type("How do I check Kubernetes node health?");
  await page.keyboard.press("Enter");
  await sleep(26000);
}
await page.screenshot({ path: "D:/ragchatbot/docs/qa/chat_after_active.png" });
console.log("AFTER-ACTIVE captured");

// structural assertions for the S1/S2/S3 fixes
const audit = await page.evaluate(() => {
  const txt = document.body.innerText;
  const pick = (re) => (txt.match(re) || [null])[0];
  return {
    retrievalPanelReal: /Chunks retrieved\s*\n?\s*(\d+|—)/.test(txt),
    hardcodedGone: !/Search type\s*\n?\s*Hybrid \+ rerank\s*\n?\s*ACL filtering\s*\n?\s*Enabled/.test(txt),
    noDoubleSpinner: !txt.includes("Generating answer…"),
    sidebarGrouped: /Today|Yesterday|Previous 7 days|Previous 30 days/.test(txt),
    disclaimerBigger: txt.includes("Answers are AI-generated"),
  };
});
console.log("AUDIT:", JSON.stringify(audit));
await browser.close();
