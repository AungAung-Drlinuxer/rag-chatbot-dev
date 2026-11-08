// Probe the chat header's status chips in the REAL ChatPage harness: for each chip report
// its text, its tone, and whether it renders an <svg> (the icon) instead of a bare dot.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 5233;
const BASE = `http://localhost:${PORT}/chat-layout-harness.html`;
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync);

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true,
  stdio: "pipe",
  cwd: process.cwd(),
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await fetch(BASE, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {}
  if (!up) await sleep(1000);
}
if (!up) {
  dev.kill();
  throw new Error("harness not reachable");
}
await sleep(2500);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
// Wide enough for `hidden lg:flex` on StatusChips.
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(`${BASE}?theme=light`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__CHAT_HARNESS__?.ready === true, { timeout: 20000 }).catch(() => {});
await sleep(1500);

const out = await page.evaluate(() => {
  const wrap = document.querySelector('[data-testid="chat-status-chips"]');
  if (!wrap) return { found: false };
  const chips = [...wrap.querySelectorAll(":scope > span")].map((el) => {
    const svg = el.querySelector("svg");
    return {
      text: (el.textContent || "").trim(),
      tone: el.getAttribute("data-tone"),
      hasIcon: !!svg,
      iconClasses: svg ? svg.getAttribute("class") : null,
      iconPaths: svg ? svg.querySelectorAll("path, circle, rect, line, ellipse").length : 0,
      dotSpans: el.querySelectorAll("span.rounded-full").length,
      title: el.getAttribute("title"),
    };
  });
  const cs = getComputedStyle(document.documentElement);
  return {
    found: true,
    chipCount: chips.length,
    chips,
    allHaveIcons: chips.every((c) => c.hasIcon),
    anyDotLeft: chips.some((c) => c.dotSpans > 0),
    accentText: cs.getPropertyValue("--accent-foreground").trim(),
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
dev.kill();
