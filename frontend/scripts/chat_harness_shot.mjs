// Screenshot + DRIVE the Chat page against a stubbed SSE transport.
//
// The page runs its own parser, its own state machine and its own components; only the
// server is fake (see src/__chat_harness__.tsx). What a redesign can quietly break:
//
//   1. the empty state is a greeting with four example cards and coverage chips from
//      /api/domains — and no invented conversation title
//   2. sending streams: user turn appears immediately, the pipeline strip reports the
//      live stage, tokens accumulate, then the done event settles the answer
//   3. the answer carries real meta — confidence, sources, retrieval numbers — and the
//      evidence rail lists the hits grouped by page
//   4. Stop aborts an in-flight answer and leaves the partial text in place
//   5. the composer grows, sends on Enter, keeps Shift+Enter as a newline, and clears
//      after send
//   6. at 390 the rail is a sheet behind the Sources button, the composer sits at the
//      bottom of the viewport and nothing overflows; at 1440 the rail is a column
//   7. dark mode uses the charcoal surface, not white
//
// Usage (dev server only): node scripts/chat_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
mkdirSync(OUT, { recursive: true });
const PORT = 5236;
const BASE = `http://localhost:${PORT}/chat-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "pipe" });
dev.stdout.on("data", () => {});
dev.stderr.on("data", () => {});
const reachable = async (u) => { try { return (await fetch(u, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; } };
let up = false;
for (let i = 0; i < 60 && !up; i++) { up = await reachable(BASE); if (!up) await sleep(1000); }
if (!up) { dev.kill(); throw new Error(`harness not reachable at ${BASE}`); }
await sleep(2200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const problems = [];
const fail = (m) => problems.push(m);
const report = {};

const open = async (query = "", width = 1440, height = 960) => {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Function components cannot be given refs/.test(m.text())) errs.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) errs.push(`${r.status()} ${r.url()}`); });
  await page.goto(BASE + query, { waitUntil: "networkidle0" });
  await sleep(500);
  return { page, errs };
};

const answerText = () =>
  [...document.querySelectorAll('[data-role="assistant"]')].pop()?.textContent ?? "";

/* ---- 1. greeting + live stream + real meta -------------------------------------- */
{
  const { page, errs } = await open("?theme=light");
  await page.screenshot({ path: `${OUT}/chat_greeting.png` });

  const greet = await page.evaluate(() => {
    const section = document.querySelector("section");
    const heroInput = document.querySelector("#chat-input")?.getBoundingClientRect();
    const heroForm = document.querySelector("#chat-input")?.closest("form")?.getBoundingClientRect();
    return {
      heading: document.querySelector("section h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      subtitle: document.querySelector("section h1 + p")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      // No example catalogue: the hero is the mark, the greeting, the composer, one note.
      examples: [...document.querySelectorAll("section button")].filter((b) =>
        /^(Database|Network|Identity|Escalation)$/i.test(b.textContent?.trim() ?? ""),
      ).length,
      heroInputInside: !!(heroInput && heroForm && heroInput.top > heroForm.top - 1 && heroInput.bottom < heroForm.bottom + 1),
      heroCentred: (() => {
        if (!section) return false;
        const r = section.getBoundingClientRect();
        const scroller = section.closest(".overflow-y-auto");
        if (!scroller) return false;
        const sr = scroller.getBoundingClientRect();
        return Math.abs(r.top - sr.top - (sr.bottom - r.bottom)) <= 24;
      })(),
      hasHeaderBar: !!document.querySelector("header"),
      hasWorkspaceLine: /Workspace · Support chat/.test(document.body.innerText),
      hasNewChatWord: [...document.querySelectorAll("button")].some((b) => /New chat$/.test((b.textContent || "").trim())),
      toastFree: !document.querySelector('[role="status"]'),
    };
  });
  if (!/^Good (morning|afternoon|evening), Ith/.test(greet.heading)) fail(`greeting heading is "${greet.heading}"`);
  if (!/Ask an IT question\. Get a clear answer grounded in your organization’s knowledge base\./.test(greet.subtitle)) {
    fail(`greeting subtitle is "${greet.subtitle}"`);
  }
  if (greet.examples !== 0) fail(`example cards should be gone, saw ${greet.examples}`);
  if (!greet.heroInputInside) fail("the composer is not inside the hero");
  if (!greet.heroCentred) fail("the hero block is not vertically centred in the chat area");
  if (greet.hasHeaderBar) fail("the page still renders a header bar");
  if (greet.hasWorkspaceLine) fail("the old Workspace · Support chat line is still rendered");
  if (greet.hasNewChatWord) fail("a text New chat button is still in the top bar position");

  // Ask by typing into the hero composer — there is no example card to click any more.
  await page.click("#chat-input");
  await page.type("#chat-input", "PostgreSQL is refusing connections — what should I check first?");
  await page.keyboard.press("Enter");
  await sleep(180);

  const sent = await page.evaluate(() => ({
    user: [...document.querySelectorAll('[data-role="user"]')].map((e) => e.textContent?.trim()).join(" | "),
    hasStrip: /Searching the knowledge base|Retrieve|Retrieval/i.test(document.body.innerText),
    composer: document.querySelector("#chat-input")?.value ?? "x",
  }));
  if (!/PostgreSQL is refusing/.test(sent.user)) fail("the example question did not become a user turn");
  if (!sent.hasStrip) fail("the live pipeline stage is not shown while answering");
  if (sent.composer !== "") fail("the composer was not cleared after sending");

  // Watch it stream: the answer must grow over several samples, not appear at once.
  const partial = await page.evaluate(async () => {
    const lens = [];
    for (let i = 0; i < 40; i++) {
      lens.push([...document.querySelectorAll('[data-role="assistant"]')].pop()?.textContent?.length ?? 0);
      await new Promise((r) => setTimeout(r, 30));
    }
    return { distinct: [...new Set(lens)].length, first: lens[0], max: Math.max(...lens) };
  });

  await sleep(1800);
  const done = await page.evaluate(() => {
    const last = [...document.querySelectorAll('[data-role="assistant"]')].pop();
    const rail = document.querySelector("aside");
    return {
      text: last?.textContent ?? "",
      len: last?.textContent?.length ?? 0,
      sources: [...(rail?.querySelectorAll("section") ?? [])].map((x) => x.textContent?.replace(/\s+/g, " ").trim()),
      railText: rail?.innerText ?? "",
      sendAgain: !!document.querySelector('button[aria-label="Send message"]'),
    };
  });
  if (partial.distinct < 3 || partial.first >= partial.max) fail(`answer did not stream (samples ${JSON.stringify(partial)})`);
  if (!/pg_isready/.test(done.text)) fail("the streamed answer body is missing");
  if (!/88%|High confidence|Confidence/i.test(done.railText + done.text)) fail("confidence from meta is not surfaced");
  if (!/PostgreSQL — connection refused/.test(done.text)) fail("the real hit titles are missing from the answer's source list");
  if (!/Connection pooling with PgBouncer/.test(done.text)) fail("the second hit is missing from the answer's source list");
  if (!/Chunks/.test(done.railText)) fail("the rail does not show retrieval numbers from meta");
  if (!done.sendAgain) fail("the send button did not come back after the stream ended");

  // Feedback and escalation must hit the real endpoints with the real payload.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Helpful$/.test(x.textContent?.trim() || ""));
    b?.click();
  });
  await sleep(250);
  const afterRate = await page.evaluate(() => ({
    sent: (window).__sent ?? [],
    thanks: /Thanks — marked helpful/.test(document.body.innerText),
  }));
  if (!afterRate.sent.some((r) => /feedback/.test(r.path))) fail("helpful feedback did not reach the API");
  if (!afterRate.thanks) fail("helpful feedback gave no confirmation");

  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Create Jira ticket/.test(x.textContent || ""));
    b?.click();
  });
  await sleep(250);
  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { open: !!d, title: d?.querySelector("h2")?.textContent ?? "", summary: d?.querySelector("input")?.value ?? "" };
  });
  if (!dialog.open) fail("the escalate dialog did not open");
  if (!/Jira/i.test(dialog.title)) fail(`unexpected escalate title "${dialog.title}"`);
  if (!/PostgreSQL is refusing/.test(dialog.summary)) fail("the ticket summary did not inherit the question");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Create ticket$/.test(x.textContent?.trim() || ""));
    b?.click();
  });
  await sleep(300);
  const afterTicket = await page.evaluate(() => ({
    sent: (window).__sent ?? [],
    closed: !document.querySelector('[role="dialog"]'),
    toast: /Ticket created in Jira/.test(document.body.innerText),
  }));
  if (!afterTicket.sent.some((r) => r.path === "/api/tickets" && /PostgreSQL/.test(r.body?.subject ?? ""))) fail("the Jira ticket was not posted with the draft");
  if (!afterTicket.closed) fail("the dialog stayed open after creating the ticket");
  if (!afterTicket.toast) fail("no confirmation after creating the ticket");

  await page.screenshot({ path: `${OUT}/chat_answer.png` });
  if (errs.length) fail(`console errors: ${errs.slice(0, 3).join(" | ")}`);
  report.greeting = greet;
  report.stream = { partial, final: done.len, sources: done.sources.length };
  await page.close();
}

/* ---- 2. stop mid-stream ---------------------------------------------------------- */
{
  const { page } = await open("?theme=light");
  await page.type("#chat-input", "VPN drops every 20 minutes");
  await page.keyboard.press("Enter");
  await sleep(320);
  const before = await page.evaluate(() => [...document.querySelectorAll('[data-role="assistant"]')].pop()?.textContent?.length ?? 0);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /^Stop$/.test(x.textContent?.trim() || ""));
    b?.click();
  });
  await sleep(700);
  const after = await page.evaluate(() => ({
    len: [...document.querySelectorAll('[data-role="assistant"]')].pop()?.textContent?.length ?? 0,
    send: !!document.querySelector('button[aria-label="Send message"]'),
  }));
  if (!before) fail("stop test never started streaming");
  if (after.len > before + 40) fail(`stop did not halt the stream (${before} → ${after.len})`);
  if (!after.send) fail("stop did not restore the composer's send button");
  await page.close();
}

/* ---- 3. composer keys ----------------------------------------------------------- */
{
  const { page } = await open("?theme=light");
  const h0 = await page.$eval("#chat-input", (el) => el.getBoundingClientRect().height);

  // Shift+Enter must not send.
  await page.type("#chat-input", "line one");
  await page.evaluate(() => {
    const el = document.querySelector("#chat-input");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  });
  await sleep(150);
  const afterShift = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('[data-role="user"]').length,
    value: document.querySelector("#chat-input").value,
  }));
  if (afterShift.bubbles !== 0) fail("Shift+Enter sent the message instead of adding a line");

  // A multi-line value must grow the box, then stop at its max.
  await page.evaluate(() => {
    const el = document.querySelector("#chat-input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(el, "line one\nline two\n" + "more text ".repeat(30));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(150);
  const h1 = await page.$eval("#chat-input", (el) => el.getBoundingClientRect().height);
  const bubbles = await page.evaluate(() => document.querySelectorAll('[data-role="user"]').length);
  if (bubbles !== 0) fail("editing the composer sent a message");
  if (!(h1 > h0 + 8)) fail(`composer did not grow (${h0} → ${h1})`);
  if (h1 > 190) fail(`composer grew past its max height (${h1})`);

  // Enter sends, and clears.
  await page.focus("#chat-input");
  await page.keyboard.press("Enter");
  await sleep(200);
  const sent = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('[data-role="user"]').length,
    value: document.querySelector("#chat-input").value,
  }));
  if (sent.bubbles !== 1) fail(`Enter did not send (${sent.bubbles} turns)`);
  if (sent.value !== "") fail("the composer was not cleared after Enter");
  await page.close();
}

/* ---- 4. responsive -------------------------------------------------------------- */
for (const [w, h, name] of [[390, 844, "390"], [768, 1024, "768"]]) {
  const { page } = await open("?theme=light", w, h);
  await page.type("#chat-input", "How do I restart the pooler safely?");
  await page.keyboard.press("Enter");
  await sleep(2400);
  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const form = document.querySelector("#chat-input")?.closest("form");
    const composer = form ? form.parentElement.getBoundingClientRect() : null;
    const headerBtn = document.querySelector('button[aria-label="Conversation details"]');
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      asideVisible: !!document.querySelector("aside") && getComputedStyle(document.querySelector("aside")).display !== "none",
      composerBottom: composer ? Math.round(window.innerHeight - composer.bottom) : -1,
      sourcesBtn: !!headerBtn && headerBtn.getBoundingClientRect().width > 0,
      width: composer ? Math.round(composer.width) : 0,
      vw: window.innerWidth,
    };
  });
  if (m.overflow > 1) fail(`${name}px: horizontal overflow ${m.overflow}px`);
  if (m.asideVisible) fail(`${name}px: the evidence rail should be a sheet, not a column`);
  if (!m.sourcesBtn) fail(`${name}px: the details control is not reachable`);
  if (m.composerBottom < 0 || m.composerBottom > 2) fail(`${name}px: the composer is not pinned to the bottom (${m.composerBottom}px gap)`);
  await page.screenshot({ path: `${OUT}/chat_${name}.png` });

  if (name === "390") {
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Conversation details"]');
      b?.click();
    });
    await sleep(300);
    const sheet = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Conversation details"]');
      return { open: !!d, width: d ? Math.round(d.getBoundingClientRect().width) : 0, hits: /Chunks|This conversation/.test(d?.innerText ?? "") ? 1 : 0 };
    });
    if (!sheet.open) fail("390px: the sources sheet did not open");
    if (sheet.hits < 1) fail("390px: the details sheet is empty");
    await page.screenshot({ path: `${OUT}/chat_390_sheet.png` });
  }
  report[name] = m;
  await page.close();
}

/* ---- 5. small talk: a greeting must not look like a KB answer -------------------- */
{
  const { page } = await open("?theme=light");
  await page.type("#chat-input", "Hi");
  await page.keyboard.press("Enter");
  await sleep(900);
  const st = await page.evaluate(() => {
    const last = [...document.querySelectorAll('[data-role="assistant"]')].pop();
    const text = last?.textContent ?? "";
    return {
      text,
      hasSources: /Sources for this answer/i.test(text),
      hasConfidence: /answer confidence|confidence/i.test(text),
      noSourceList: !/PostgreSQL — connection refused/.test(document.body.innerText),
    };
  });
  if (!/Hello! I'm your internal IT support assistant\. How can I help you today\?/.test(st.text)) {
    fail(`small talk reply is wrong: "${st.text.slice(0, 120)}"`);
  }
  if (st.hasSources) fail("the greeting answer still lists KB sources");
  if (st.hasConfidence) fail("the greeting answer still shows a confidence score");
  if (!st.noSourceList) fail("unrelated KB titles leaked into the greeting conversation");
  await page.screenshot({ path: `${OUT}/chat_smalltalk.png` });
  await page.close();
}

/* ---- 5. dark -------------------------------------------------------------------- */
{
  const { page } = await open("?theme=dark");
  await page.type("#chat-input", "PostgreSQL pool exhaustion");
  await page.keyboard.press("Enter");
  await sleep(2600);
  const dark = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const card = document.querySelector("form");
    return {
      bg: cs.getPropertyValue("--background").trim(),
      cardBg: card ? getComputedStyle(card).backgroundColor : "",
      text: cs.getPropertyValue("--foreground").trim(),
    };
  });
  if (dark.cardBg === "rgb(255, 255, 255)") fail("dark mode still renders white surfaces");
  await page.screenshot({ path: `${OUT}/chat_dark.png` });
  report.dark = dark;
  await page.close();
}

await browser.close();
dev.kill();

console.log(JSON.stringify(report, null, 2));
if (problems.length) {
  console.log(`\nFAILED (${problems.length})`);
  problems.forEach((p) => console.log(" - " + p));
  process.exit(1);
}
console.log("\nOK: greeting, streaming, real meta, stop, composer and breakpoints all hold");
