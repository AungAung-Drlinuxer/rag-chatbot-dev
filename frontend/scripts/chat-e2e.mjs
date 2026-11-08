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
  await page.type('input[type="text"]', "dev", { delay: 15 });
  await page.type('input[type="password"]', "dev", { delay: 15 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1400);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(2000);
  // start a fresh chat
  const newChatBtn = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.title === "Clear all conversations");
    if (!btn) return null;
    // click New conversation instead
    const nc = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("New conversation"));
    nc?.click();
    return "new";
  });
  console.log("chat prep:", newChatBtn);
  await sleep(800);
  // type and send a question
  const ta = await page.$("textarea");
  if (ta) {
    await ta.type("What is the status of ticket ITHD-8?", { delay: 5 });
    await page.keyboard.press("Enter");
  }
  // wait for answer to appear
  await sleep(12000);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/chat-e2e.png" });
  const txt = await page.evaluate(() => {
    const m = document.querySelectorAll("[class*='prose'], .markdown, p, div");
    for (const e of m) {
      const t = e.textContent || "";
      if (t.length > 50 && t.includes("provided context")) return t.slice(0, 300);
    }
    return "(not found)";
  });
  console.log("answer text on screen:", txt);
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }