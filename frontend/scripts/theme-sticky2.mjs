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
  await page.evaluate(() => { window.location.hash = "#/settings"; });
  await sleep(1800);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const dark = btns.find((b) => b.textContent.trim() === "Dark");
    if (dark) dark.click();
  });
  await sleep(300);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const save = btns.find((b) => b.textContent.includes("Save changes"));
    if (save) save.click();
  });
  await sleep(1500);
  const st1 = await page.evaluate(() => ({
    ls: localStorage.getItem("ith.dark"),
    theme: document.documentElement.getAttribute("data-theme"),
  }));
  console.log("after save:", JSON.stringify(st1));
  await page.reload({ waitUntil: "networkidle0" });
  await sleep(2200);
  const st2 = await page.evaluate(() => ({
    ls: localStorage.getItem("ith.dark"),
    theme: document.documentElement.getAttribute("data-theme"),
    path: location.hash,
  }));
  console.log("after reload:", JSON.stringify(st2));
  console.log(st1.ls === "1" && st2.theme === "dark" ? "THEME STICKY OK" : "PROBLEM");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }