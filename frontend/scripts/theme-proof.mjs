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
  await page.evaluate(() => { window.location.hash = "#/dashboard"; });
  await sleep(2000);
  // Read computed primary color and sidebar accent
  const colors = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const sidebar = document.querySelector("aside");
    return {
      dataTheme: root.getAttribute("data-theme"),
      primary: cs.getPropertyValue("--primary").trim(),
      accent: cs.getPropertyValue("--accent").trim(),
      background: cs.getPropertyValue("--background").trim(),
      sidebarBg: cs.getPropertyValue("--sidebar-bg").trim(),
      sidebarActiveBg: cs.getPropertyValue("--sidebar-active-bg").trim(),
    };
  });
  console.log("Computed light theme tokens:");
  for (const [k, v] of Object.entries(colors)) console.log("  " + k + ": " + v);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/theme-light-v0.21.52-PROOF.png" });
  console.log("DONE");
} catch (e) { console.log("FAIL", e.message); }
finally { await browser.close(); }