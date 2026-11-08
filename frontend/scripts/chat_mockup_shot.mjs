// Photograph the chat page as it now stands (mockup round).
//
// chat_layout_harness_shot.mjs bails before its screenshot when its assertions fail, so it
// produced no image while the seeded-conversation problem was open. This script does one
// thing: render the harness and capture it. It makes NO assertions, so it always writes an
// image — which is the point, because the header, palette and chrome are visible whether or
// not a conversation loaded.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "../docs/qa";
const PORT = 5227;
const BASE = `http://localhost:${PORT}/chat-layout-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

mkdirSync(OUT, { recursive: true });

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

async function reachable(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  up = await reachable(BASE);
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error(`harness not reachable at ${BASE}`);
}
await sleep(3000);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const out = {};
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle0" });
  await sleep(2500);

  // What the header actually shows, read from the DOM rather than from the source.
  const probe = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-testid="chat-status-chips"] > span')];
    const root = getComputedStyle(document.documentElement);
    const el = document.querySelector('[data-testid="chat-status-chips"]');
    return {
      chips: chips.map((c) => ({ text: c.textContent.trim(), tone: c.dataset.tone })),
      chipsPresent: !!el,
      background: root.getPropertyValue("--background").trim(),
      primary: root.getPropertyValue("--primary").trim(),
      card: root.getPropertyValue("--card").trim(),
    };
  });
  out[theme] = probe;
  await page.screenshot({ path: `${OUT}/chat_mockup_${theme}.png`, fullPage: false });
  await page.close();
}

await browser.close();
dev.kill();
console.log(JSON.stringify(out, null, 2));
