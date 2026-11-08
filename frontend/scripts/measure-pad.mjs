import puppeteer from "puppeteer-core";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  let authed = false;
  async function probe(name, sel) {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".navitem")].find((e) => e.textContent.toLowerCase().includes(n)); if (el) el.click(); }, name);
    await sleep(1400);
    const m = await page.evaluate((sel) => {
      const sec = [...document.querySelectorAll(".page")].find((x) => x.querySelector(sel)) || document.querySelector(".page");
      const cs = getComputedStyle(sec);
      let minLeft = 9999;
      sec.querySelectorAll("*").forEach((el) => { const r = el.getBoundingClientRect(); if (r.width > 5 && r.left >= 0) minLeft = Math.min(minLeft, r.left); });
      return { pad: cs.paddingLeft + "/" + cs.paddingRight, minLeft: Math.round(minLeft), vw: innerWidth };
    }, sel);
    console.log(name, JSON.stringify(m));
  }
  for (const W of [390, 768, 1024]) {
    try {
      await page.setViewport({ width: W, height: 900 });
      await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle0" });
      if (!authed) {
        await page.type("#u", "dev"); await page.type("#p", "dev");
        await page.keyboard.press("Enter");
        authed = true;
      }
      await page.waitForSelector(".sidebar", { timeout: 15000 });
      for (const [name, sel] of [["escalations",".esc-card, .elist, .card"],["settings","[data-slot=card]"],["knowledge",".kb-page"]]) {
        await probe(name, sel);
      }
    } catch (e) { console.log(W + "px:", e.message.slice(0, 90)); }
  }
} catch (e) { console.log("FAIL " + e.message); } finally { await browser.close(); }
