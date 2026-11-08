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
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE_ERR:", m.text().slice(0, 200)); });
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
  await sleep(2500);
  // use the React-friendly input
  await page.focus("textarea");
  await page.keyboard.type("What is the status of ticket ITHD-8?", { delay: 5 });
  // click the send button (input type=submit or button near textarea)
  const sent = await page.evaluate(() => {
    const btn = document.querySelector("form button[type=submit]") ||
                Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Send") || b.textContent.includes("Submit"));
    if (btn) { btn.click(); return btn.textContent; }
    return null;
  });
  console.log("clicked send button:", sent);
  // wait + take a series of screenshots
  for (let i = 1; i <= 3; i++) {
    await sleep(5000);
    await page.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/chat-wait-${i}.png` });
  }
  // inspect all text containing "context" or ticket
  const answer = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("div, p, span"));
    for (const e of all) {
      const t = (e.textContent || "").trim();
      if (t.length > 40 && /context|ITHD|ticket|answer/i.test(t) && !t.includes("What is the status")) return t.slice(0, 250);
    }
    return null;
  });
  console.log("on-screen text:", answer);
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }