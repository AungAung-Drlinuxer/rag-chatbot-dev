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
  await page.keyboard.type("What IT issues can you help with?", { delay: 5 });
  await page.keyboard.press("Enter");
  // wait up to 45s for streaming answer
  let answer = "";
  for (let i = 0; i < 15; i++) {
    await sleep(3000);
    answer = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("div, p"));
      for (const e of els) {
        const t = (e.textContent || "").trim();
        if (t.length > 40 && !t.includes("What IT issues can you help")) return t.slice(0, 250);
      }
      return "";
    });
    if (answer) break;
  }
  console.log("ANSWER ON SCREEN:", answer || "(EMPTY — no response in 45s)");
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/chat-realtime-e2e.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }