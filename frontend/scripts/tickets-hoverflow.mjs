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
  await page.evaluate(() => { window.location.hash = "#/tickets"; });
  await sleep(5000);
  const info = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll("div")).find(
      (d) => typeof d.className === "string" && d.className.indexOf("overflow-y-auto") >= 0 && d.className.indexOf("420") >= 0
    );
    if (!box) return null;
    const bw = box.clientWidth;
    const offenders = [];
    for (const el of box.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right > bw + box.getBoundingClientRect().left + 2 && r.width > 0) {
        offenders.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          w: Math.round(r.width),
          text: (el.textContent || "").trim().slice(0, 40),
        });
      }
    }
    return { boxW: bw, sw: box.scrollWidth, offenders: offenders.slice(0, 6) };
  });
  console.log(JSON.stringify(info, null, 1));
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }