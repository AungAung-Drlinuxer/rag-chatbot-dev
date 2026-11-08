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
  await sleep(600);
  await page.type('input[type="text"]', "dev", { delay: 20 });
  await page.type('input[type="password"]', "dev", { delay: 20 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  await page.evaluate(() => { window.location.hash = "#/chat"; });
  await sleep(2500);
  // find the dots trigger, scroll into view, get box, real-click
  const box = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".group.relative"));
    if (!items.length) return null;
    const item = items[0];
    item.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    const dots = item.querySelector("button[aria-label='Conversation menu']");
    if (!dots) return null;
    dots.style.display = "block";
    const r = dots.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) { console.log("no dots button found"); }
  else {
    await page.mouse.click(box.x, box.y);
    await sleep(900);
    const pos = await page.evaluate(() => {
      const menu = Array.from(document.querySelectorAll("[role=menu]"))[0];
      if (!menu) return null;
      const r = menu.getBoundingClientRect();
      return { top: Math.round(r.top), left: Math.round(r.left) };
    });
    console.log("menu pos:", JSON.stringify(pos));
  }
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/conv-menu-fixed.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }