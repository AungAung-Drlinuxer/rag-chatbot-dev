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
  // find elements with the "content" of the streamed message: look for a markdown-rendered
  // div inside the assistant bubble. The assistant bubble usually follows the user bubble.
  let ans = "";
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    ans = await page.evaluate(() => {
      // messages are rendered inside a chat container; assistant content comes after
      // user content. Find all direct text nodes > 30 chars that mention "assistant"-ish
      const divs = Array.from(document.querySelectorAll("[class*='markdown'], [class*='prose'], [class*='bubble']"));
      for (const d of divs) {
        const t = (d.textContent || "").trim();
        if (t.length > 30 && !t.includes("What IT issues")) return t.slice(0, 300);
      }
      return "";
    });
    if (ans) break;
  }
  console.log("ASSISTANT ANSWER:", ans || "(EMPTY after 40s)");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/realtime-2.png" });
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }