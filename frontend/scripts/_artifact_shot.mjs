// Render an HTML artifact to a crisp PNG via headless Chrome.
//
// Usage: node scripts/_artifact_shot.mjs <input.html> <output.png> [width]
import puppeteer from "puppeteer-core";
import { resolve } from "node:path";

const [input, output, widthArg] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: node scripts/_artifact_shot.mjs <in.html> <out.png> [width]");
  process.exit(2);
}
const WIDTH = Number(widthArg || 1400);

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.setViewport({ width: WIDTH, height: 1200, deviceScaleFactor: 2 });
await page.goto("file:///" + resolve(input).replace(/\\/g, "/"), { waitUntil: "networkidle0", timeout: 60000 });
// The webfont is remote; give it a beat so the shot is not taken in a fallback face.
await page.evaluate(() => document.fonts?.ready);
await new Promise((r) => setTimeout(r, 1200));

const size = await page.evaluate(() => ({
  w: document.documentElement.scrollWidth,
  h: document.documentElement.scrollHeight,
}));
await page.screenshot({ path: output, fullPage: true });
await browser.close();
console.log(JSON.stringify({ output, ...size, jsErrors: errors }, null, 2));
process.exit(0);
