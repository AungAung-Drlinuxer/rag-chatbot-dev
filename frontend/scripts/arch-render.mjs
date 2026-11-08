// Render docs/architecture-current.html -> PNG via headless Chrome.
// Run: cd desktop && node scripts/arch-render.mjs
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../.."); // repo root
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SRC = resolve(ROOT, "docs/architecture-current.html");
const OUT = resolve(ROOT, "docs/architecture-current.png");
mkdirSync(dirname(OUT), { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1200, deviceScaleFactor: 2 }); // 2x for crisp text
  await page.goto("file:///" + SRC.replace(/\\/g, "/"), { waitUntil: "networkidle0", timeout: 20000 });
  await page.waitForSelector("h1", { timeout: 10000 });
  // Full page height (max body height), width capped to viewport
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewport({ width: 1500, height: h, deviceScaleFactor: 2 });
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("ARCH_PNG_OK " + OUT + " height=" + h);
} catch (e) {
  console.log("ARCH_RENDER_FAIL " + e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
