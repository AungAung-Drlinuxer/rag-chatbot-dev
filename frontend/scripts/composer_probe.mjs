// Composer probe — measure the chat page's type area as RENDERED, not as read from source.
//
// The reference strip the user sent (921x104) shows one bordered container holding, left to
// right: a bordered "All connectors" pill, an attach icon, the "Ask an IT question..." field,
// a "Ctrl+Enter" key hint, and a round accent Send button carrying a paper-plane glyph.
//
// The harness renders the REAL ChatPage (only fetch is stubbed), so everything measured here
// is the shipped component. The dashboard stub in __chat_layout_harness__.tsx is what makes the
// scope pill mount at all — it hides itself when the server list is empty.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = "/home/aungaung/Documents/rag-chatbot/docs/qa";
const PORT = 5237;
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

const report = {};
for (const theme of ["light", "dark"]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle0" });
  await sleep(2500);

  // Type a question first: Send is `disabled={!input.trim()}`, so an empty field photographs
  // the disabled grey button instead of the accent disc the reference draws.
  await page.click("form textarea");
  await page.type("form textarea", "Loki မှာ label ဘာတွေရှိလဲ");
  await sleep(400);

  const probe = await page.evaluate(() => {
    const form = document.querySelector("form");
    const textarea = form?.querySelector("textarea");
    // The field is the textarea's nearest bordered ancestor — the one row that holds
    // the pill, the attach button, the hint and the send button.
    let field = textarea?.parentElement ?? null;
    while (field && !getComputedStyle(field).borderTopWidth.includes("px")) field = field.parentElement;
    while (field && getComputedStyle(field).borderTopWidth === "0px") field = field.parentElement;

    const cs = field ? getComputedStyle(field) : null;
    const kids = field ? [...field.children] : [];

    const pill = field?.querySelector("button[aria-haspopup='listbox']") ?? null;
    const pillCs = pill ? getComputedStyle(pill) : null;

    const send = form?.querySelector("button[type='submit']") ?? null;
    const sendCs = send ? getComputedStyle(send) : null;
    const sendSvg = send?.querySelector("svg") ?? null;

    const kbd = field?.querySelector("kbd") ?? null;

    return {
      fieldPresent: !!field,
      field: cs && {
        borderTopWidth: cs.borderTopWidth,
        borderTopColor: cs.borderTopColor,
        borderRadius: cs.borderTopLeftRadius,
        backgroundColor: cs.backgroundColor,
      },
      childOrder: kids.map((k) => k.tagName.toLowerCase() + (k.dataset?.testid ? `#${k.dataset.testid}` : "")),
      pill: pillCs && {
        text: pill.textContent.trim(),
        borderWidth: pillCs.borderTopWidth,
        borderColor: pillCs.borderTopColor,
        borderRadius: pillCs.borderTopLeftRadius,
        hasPlugIcon: !!pill.querySelector("svg.lucide-plug"),
        iconCount: pill.querySelectorAll("svg").length,
      },
      placeholder: textarea?.getAttribute("placeholder") ?? null,
      hint: kbd?.textContent.trim() ?? null,
      send: sendCs && {
        ariaLabel: send.getAttribute("aria-label"),
        title: send.getAttribute("title"),
        width: Math.round(send.getBoundingClientRect().width),
        height: Math.round(send.getBoundingClientRect().height),
        borderRadius: sendCs.borderTopLeftRadius,
        background: sendCs.backgroundColor,
        glyph: sendSvg?.getAttribute("class") ?? null,
      },
      // Anything still drawing a bare text glyph in this row is a regression.
      textGlyphs: (field?.textContent.match(/[◐✓○⏱▲▼⚡]/g) ?? []),
    };
  });

  report[theme] = probe;

  // Screenshot just the composer row, so the image is the thing under review.
  const box = await page.evaluate(() => {
    const ta = document.querySelector("form textarea");
    let f = ta?.parentElement ?? null;
    while (f && getComputedStyle(f).borderTopWidth === "0px") f = f.parentElement;
    if (!f) return null;
    const r = f.getBoundingClientRect();
    return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16 };
  });
  if (box) {
    await page.screenshot({
      path: `${OUT}/composer_${theme}.png`,
      clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height: box.height },
    });
  }
}

await browser.close();
dev.kill();
console.log(JSON.stringify(report, null, 2));
