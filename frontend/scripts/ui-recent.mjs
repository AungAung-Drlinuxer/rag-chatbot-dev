// UI check — RECENT CONVERSATIONS sidebar: list, green dot, open, clear confirm.
import puppeteer from "puppeteer-core";
const BASE = "http://localhost:1420";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new" });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
const shot = (f) => p.screenshot({ path: `C:/Users/aungaung/it-help-chatbot/docs/${f}` });
let step = "";
try {
  await p.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await p.waitForSelector("input[placeholder=Username]", { timeout: 30000 });
  step = "login";
  await p.type("input[placeholder=Username]", "dev");
  await p.type("input[placeholder=Password]", "dev");
  const btns = await p.$$("button"); for (const bt of btns) { const t = (await bt.evaluate(el => el.textContent)).trim(); if (t === "Sign in") { await bt.click(); break; } }
  await p.waitForSelector(".navitem", { timeout: 30000 });

  step = "recent-section";
  await p.waitForSelector(".recent", { timeout: 15000 });
  const title = await p.evaluate(() => document.querySelector(".recent-title")?.textContent?.trim());
  const nConvs = await p.$$eval(".conv", (els) => els.length);
  const hasClear = await p.evaluate(() => !!document.querySelector(".clear-btn"));
  const hasViewAll = await p.evaluate(() => !!document.querySelector(".view-all"));
  const firstTitle = await p.evaluate(() => document.querySelector(".conv-title")?.textContent?.trim());
  const firstWhen = await p.evaluate(() => document.querySelector(".conv-when")?.textContent?.trim());
  console.log("STEP: recent-title =", title, "| convs =", nConvs, "| clear =", hasClear, "| viewAll =", hasViewAll);
  console.log("STEP: first =", JSON.stringify({ firstTitle, firstWhen }));
  await shot("ui-recent-list.png");

  step = "open-conv";
  if (await p.$(".conv")) {
    await p.click(".conv");
    await new Promise(r => setTimeout(r, 1200));
    const nMsg = await p.$$eval(".msg", (els) => els.length);
    const active = await p.evaluate(() => !!document.querySelector(".conv.active"));
    console.log("STEP: opened conv, msgs =", nMsg, "| active dot =", active);
    await shot("ui-recent-open.png");
  }

  step = "clear-confirm";
  if (await p.$(".clear-btn")) {
    await p.click(".clear-btn");
    await new Promise(r => setTimeout(r, 500));
    const modal = await p.evaluate(() => document.querySelector(".modal-title")?.textContent?.trim());
    await shot("ui-recent-clear.png");
    console.log("STEP: clear modal title =", JSON.stringify(modal));
    await p.evaluate(() => { const c = [...document.querySelectorAll(".modal-actions button")].find(x => x.textContent.includes("Cancel")); if (c) c.click(); });
    await new Promise(r => setTimeout(r, 400));
    console.log("STEP: modal gone after cancel =", await p.evaluate(() => !document.querySelector(".modal")));
  }

  console.log("UI_RECENT_OK");
} catch (e) {
  console.log("FAIL at", step, "=>", String(e).slice(0, 220));
  try { await shot("ui-recent-fail.png"); } catch {}
}
await b.close();
