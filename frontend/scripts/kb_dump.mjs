import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--ignore-certificate-errors", "--window-size=1600,1100"],
  defaultViewport: { width: 1600, height: 1100 },
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
  await sleep(4500);
}
await page.keyboard.press("Escape");
await sleep(500);
// the hash route does not switch pages here — click the sidebar nav item
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Knowledge");
  if (b) b.click();
});
await sleep(7000);
const dump = await page.evaluate(() => {
  const heads = [...document.querySelectorAll("th")].map((t) => (t.textContent || "").trim());
  const badgeCounts = {};
  document.querySelectorAll("tbody tr").forEach((tr) => {
    const cells = tr.querySelectorAll("td");
    if (cells.length > 1) {
      const label = (cells[1].textContent || "").trim();
      if (label) badgeCounts[label] = (badgeCounts[label] || 0) + 1;
    }
  });
  window.__kbAudit = { heads, badgeCounts, rows: document.querySelectorAll("tbody tr").length };
  const main = document.querySelector("main") || document.body;
  return {
    innerTextHead: main.innerText.slice(0, 900),
    buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 25),
    cards: [...document.querySelectorAll('[class*="rounded-2xl"],[class*="card"]')].slice(0, 6).map((e) => (e.textContent || "").trim().slice(0, 60)),
  };
});
console.log("KB AUDIT:", JSON.stringify(await page.evaluate(() => window.__kbAudit)));
console.log(JSON.stringify(dump, null, 1).slice(0, 700));
await page.screenshot({ path: "D:/ragchatbot/docs/qa/kb_page_state.png" });
await browser.close();