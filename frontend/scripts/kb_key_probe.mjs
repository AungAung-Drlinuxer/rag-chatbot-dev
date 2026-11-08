// One-off probe: find the DOM node React warns about ("unique key prop").
// Walks React fibers and reports elements whose fiber has no key while sitting among
// siblings — which is exactly the condition React complains about.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 5231;
const BASE = `http://localhost:${PORT}/knowledge-harness.html`;
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
await page.setViewport({ width: 1440, height: 1200 });
await page.goto(`${BASE}?theme=light&scenario=list`, { waitUntil: "networkidle0" });
await page.waitForFunction(() => window.__KB_HARNESS__?.ready === true, { timeout: 20000 });
await sleep(1000);

const found = await page.evaluate(() => {
  const fiberKey = (el) => Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  const out = [];

  // React's warning is about ARRAYS of children, so inspect the parent fiber's
  // memoizedProps.children: if it is an array, every element in it needs a key.
  const walk = (el, path) => {
    const fk = fiberKey(el);
    if (fk) {
      const fiber = el[fk];
      const kids = fiber.return?.memoizedProps?.children;
      const asArray = Array.isArray(kids) ? kids : kids == null ? [] : [kids];
      asArray.forEach((child, i) => {
        if (child && typeof child === "object" && "type" in child && child.key == null) {
          out.push({
            childIndex: i,
            type: typeof child.type === "string" ? child.type : (child.type?.name ?? "?"),
            arrayLength: asArray.length,
            parentTag: el.tagName,
            parentClass: (el.className || "").toString().slice(0, 70),
            path,
          });
        }
      });
    }
    [...el.children].forEach((c, i) => walk(c, `${path}>${c.tagName}[${i}]`));
  };

  walk(document.getElementById("root"), "root");

  // de-duplicate: the same parent is visited once per child element
  const seen = new Set();
  return out.filter((o) => {
    const k = `${o.path}|${o.childIndex}|${o.type}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
});

console.log(JSON.stringify(found, null, 2));
await browser.close();
dev.kill();
