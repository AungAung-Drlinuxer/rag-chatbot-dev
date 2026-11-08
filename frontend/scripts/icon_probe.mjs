/**
 * icon_probe.mjs — prove the chat page's state indicators render ICONS, not text glyphs.
 *
 * Why: the pipeline strip used to draw its state with Unicode characters (U+25D0, U+2713,
 * U+25CB) and its steps as bare numbers, while the in-bubble AgentActivity used lucide
 * icons. One pipeline, two spellings. This asserts the single language now:
 *   - every step disc contains an <svg> (the stage glyph), not a digit
 *   - every state marker is an <svg>, and NO text glyph characters survive
 *   - the step glyphs are the SAME icon set AgentActivity uses
 *
 * Arithmetic assertions only — no aesthetic judgement.
 */
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const PORT = 5235;
const BASE = `http://localhost:${PORT}/chat-layout-harness.html`;
// Absolute, so the shots always land in the repo's docs/qa regardless of cwd.
const OUT = "/home/aungaung/Documents/rag-chatbot/docs/qa";
const CHROME =
  process.env.CHROME_PATH ||
  "/usr/bin/google-chrome";

const results = {};

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});

async function waitForServer(ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("vite did not come up");
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: existsSync(CHROME) ? CHROME : undefined,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 45000 });

  // The harness mounts the real RagPipelineStatus on demand. Drive it ACTIVE and OPEN
  // so both the collapsed strip and the expanded details list are in the DOM.
  // Wait for the harness to finish its synchronous mount before driving it.
  await page.waitForFunction(() => window.__CHAT_HARNESS__ && window.__CHAT_HARNESS__.ready === true, {
    timeout: 20000,
  });
  const mounted = await page.evaluate(() => {
    const h = window.__CHAT_HARNESS__;
    if (!h || typeof h.pipeline !== "function") return "no-harness";
    h.pipeline(true, true);
    return "mounted";
  });
  results.mounted = mounted;
  await new Promise((r) => setTimeout(r, 1200));

  results.pipeline = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="rag-pipeline-stages"]');
    const out = { stripPresent: !!strip, discs: [], stateMarkers: [] };

    if (strip) {
      // Every step disc: an <svg> (the stage glyph) or a bare digit?
      // The connector bars between steps are also rounded-full — select the badge by
      // its data-step attribute so only real step discs are counted.
      for (const disc of strip.querySelectorAll("[data-step] > span:first-child")) {
        const svg = disc.querySelector("svg");
        const txt = (disc.textContent || "").trim();
        out.discs.push({
          hasSvg: !!svg,
          svgClass: svg ? svg.getAttribute("class") || "" : null,
          text: txt,
          isBareDigit: /^\d+$/.test(txt),
        });
      }
    }

    // Any surviving text glyph characters anywhere in the tracker?
    const tracker = document.querySelector('[data-testid="rag-pipeline-tracker"]');
    if (tracker) {
      const bad = ["\u25D0", "\u2713", "\u25CB", "\u23F1", "\u25B2", "\u25BC", "\u26A1"];
      const t = tracker.textContent || "";
      out.textGlyphsFound = bad.filter((c) => t.includes(c));
      out.svgCount = tracker.querySelectorAll("svg").length;
    }

    // The tracker header badge
    const hdr = tracker?.querySelector("span.rounded-full");
    out.headerBadge = hdr
      ? { hasSvg: !!hdr.querySelector("svg"), text: (hdr.textContent || "").trim() }
      : null;

    // Expanded details rows: each has a disc AND a status pill. Both must be icons.
    out.detailRows = tracker
      ? [...tracker.querySelectorAll("li")].map((li) => {
          const spans = [...li.querySelectorAll("span")];
          const disc = spans.find((s) => (s.className || "").includes("size-5"));
          const pill = spans.find((s) => (s.className || "").includes("w-20"));
          return {
            discHasSvg: !!(disc && disc.querySelector("svg")),
            discText: disc ? (disc.textContent || "").trim() : null,
            pillHasSvg: !!(pill && pill.querySelector("svg")),
            pillText: pill ? (pill.textContent || "").trim() : null,
          };
        })
      : [];

    return out;
  });

  // AgentActivity's stage badge — same disc language?
  results.agentActivity = await page.evaluate(() => {
    const el = document.querySelector(".agent-icon-pop");
    if (!el) return { present: false };
    const svg = el.querySelector("svg");
    return {
      present: true,
      hasSvg: !!svg,
      svgClass: svg ? svg.getAttribute("class") || "" : null,
      containerClass: el.getAttribute("class") || "",
      isSolidDisc: (el.getAttribute("class") || "").includes("rounded-full"),
    };
  });

  // Whole-page scan: no text glyphs left as icon substitutes.
  results.pageGlyphScan = await page.evaluate(() => {
    const bad = {
      "\u25D0": "half-circle", "\u2713": "check", "\u25CB": "circle",
      "\u23F1": "stopwatch", "\u25B2": "up-triangle", "\u25BC": "down-triangle",
    };
    const found = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walk.nextNode())) {
      const t = n.nodeValue || "";
      for (const [ch, name] of Object.entries(bad)) if (t.includes(ch)) found.push(name);
    }
    return [...new Set(found)];
  });

  mkdirSync(OUT, { recursive: true });

  // Park the pipeline on-screen and isolate it, so the shot shows the icons rather
  // than the chat page the harness also renders.
  await page.evaluate(() => {
    const host = document.getElementById("pipeline-host");
    const root = document.getElementById("root");
    if (!host) return;
    // #pipeline-host is a SIBLING of ChatPage inside #root — hiding body's children
    // would hide the host too. Hide root's other children instead.
    if (root) {
      for (const el of Array.from(root.children)) {
        if (el !== host) el.style.display = "none";
      }
    }
    host.style.position = "static";
    host.style.left = "0";
    host.style.padding = "24px";
    host.style.background = "var(--background)";
    document.body.style.background = "var(--background)";
  });
  await new Promise((r) => setTimeout(r, 500));

  const tracker = await page.$('[data-testid="rag-pipeline-tracker"]');
  if (tracker) await tracker.screenshot({ path: `${OUT}/chat_pipeline_icons_light.png` });
  await page.screenshot({ path: `${OUT}/chat_icons_light.png` });

  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await new Promise((r) => setTimeout(r, 600));
  const trackerDark = await page.$('[data-testid="rag-pipeline-tracker"]');
  if (trackerDark) await trackerDark.screenshot({ path: `${OUT}/chat_pipeline_icons_dark.png` });
  await page.screenshot({ path: `${OUT}/chat_icons_dark.png` });
} catch (e) {
  results.error = String(e && e.message ? e.message : e);
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
}

console.log(JSON.stringify(results, null, 2));
