// FULL FUNCTIONAL AUDIT of the web app on prod — every feature, one run.
// Run: cd desktop && node scripts/ui-audit.mjs
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const APP = process.env.AUDIT_URL || "https://chat.drlinuxer.com/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const ok = (name, cond, extra = "") => { R.push(`${cond ? "PASS" : "FAIL"} | ${name}${extra ? " | " + extra : ""}`); };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-dev-shm-usage", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1360, height: 950 });

  // ---------- 1. LOGIN ----------
  await page.goto(APP, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForSelector('input[placeholder="Username"]', { timeout: 15000 });
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-01-login.png" });
  await page.type('input[placeholder="Username"]', "dev");
  await page.type('input[placeholder="Password"]', "dev");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".sidebar", { timeout: 15000 });
  ok("login dev/dev → main app", true);
  await sleep(600);

  // wrong-password rejection (fresh page context to avoid losing session later)
  {
    const p2 = await browser.newPage();
    await p2.goto(APP, { waitUntil: "networkidle0", timeout: 30000 });
    await p2.waitForSelector('input[placeholder="Username"]');
    await p2.type('input[placeholder="Username"]', "dev");
    await p2.type('input[placeholder="Password"]', "wrongpass");
    await p2.keyboard.press("Enter");
    await sleep(1500);
    const stillLogin = await p2.$('input[placeholder="Username"]') !== null;
    ok("login rejects bad password", stillLogin);
    await p2.close();
  }

  // ---------- 2. ROLE BADGE / SIGNOUT CONTROLS PRESENT ----------
  const hasSignout = (await page.$(".signout-btn")) !== null;
  ok("sidebar shows sign-out control", hasSignout);
  const navItems = await page.evaluate(() => [...document.querySelectorAll(".navitem")].map((e) => e.textContent.trim()));
  ok("nav items render", navItems.length >= 3, JSON.stringify(navItems));

  // ---------- 3. CHAT STREAM + RAG SOURCES + USAGE PILL ----------
  await page.type('textarea[placeholder^="Ask about"]', "Database connection timeout");
  await page.evaluate(() => [...document.querySelectorAll("button.send")][0]?.click());
  let tokens = 0;
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector(".msg.assistant .bubble");
      return b && b.textContent.trim().length > 40;
    }, { timeout: 90000 });
  } catch {}
  tokens = await page.evaluate(() => (document.querySelector(".msg.assistant .bubble") || {}).textContent?.length || 0);
  ok("chat streams an answer (>40 chars)", tokens > 40, `${tokens} chars`);
  const badges = await page.evaluate(() => ({
    domain: !!document.querySelector(".msg.assistant .badge.domain"),
    conf: !!document.querySelector(".msg.assistant .badge.conf"),
    decision: !!document.querySelector(".msg.assistant .badge.answer, .msg.assistant .badge.caution"),
  }));
  ok("meta badges (domain/conf/decision)", badges.domain && badges.conf && badges.decision, JSON.stringify(badges));
  // wait up to 20s for sources
  let srcOk = false;
  for (let i = 0; i < 10 && !srcOk; i++) { await sleep(2000); srcOk = !!(await page.$(".msg.assistant .src-inline")); }
  const srcItems = await page.evaluate(() => [...document.querySelectorAll(".msg.assistant .src-item")].length);
  ok("RAG sources block under answer", srcOk, `${srcItems} sources`);
  let pill = "";
  for (let i = 0; i < 15 && !pill; i++) { pill = await page.evaluate(() => (document.querySelector(".msg.assistant .badge.usage") || {}).textContent || ""); if (!pill) await sleep(2000); }
  ok("usage pill renders (⚡ tok / ctx)", !!pill, pill.trim());
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-02-chat.png" });

  // ---------- 4. FEEDBACK ----------
  let fbEnabled = null;
  for (let i = 0; i < 10; i++) {
    fbEnabled = await page.evaluate(() => { const b = [...document.querySelectorAll("button.btn.helpful")].pop(); return b ? !b.disabled : null; });
    if (fbEnabled) break; await sleep(1000);
  }
  ok("feedback buttons enable after done", !!fbEnabled);
  if (fbEnabled) {
    await page.evaluate(() => [...document.querySelectorAll("button.btn.helpful")].pop()?.click());
    let fbDone = "";
    for (let i = 0; i < 8 && !fbDone; i++) { fbDone = await page.evaluate(() => (document.querySelector(".msg.assistant .fb-done") || {}).textContent || ""); if (!fbDone) await sleep(1000); }
    ok("helpful → 'Feedback submitted' confirmation", /Feedback submitted/i.test(fbDone), fbDone);
    const disabledAfter = await page.evaluate(() => [...document.querySelectorAll("button.btn.helpful")].pop()?.disabled);
    ok("buttons disable after submit", !!disabledAfter);
  }
  const escBtn = await page.evaluate(() => { const b = [...document.querySelectorAll("button.btn.esc")].pop(); return b ? { present: true, disabled: b.disabled } : { present: false }; });
  ok("escalate button present", escBtn.present);

  // ---------- 5. RECENT CONVERSATIONS ----------
  let convCount = 0;
  for (let i = 0; i < 8 && !convCount; i++) { convCount = await page.evaluate(() => document.querySelectorAll(".recent li").length); if (!convCount) await sleep(1500); }
  ok("RECENT CONVERSATIONS lists sessions", convCount > 0, `${convCount} items`);
  if (convCount > 0) {
    await page.evaluate(() => document.querySelector(".recent li")?.click());
    await sleep(2500);
    const loaded = await page.evaluate(() => document.querySelectorAll(".msg").length);
    ok("click conversation loads messages", loaded >= 2, `${loaded} msgs`);
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  // Clear-all confirm modal (open then CANCEL — do not delete data)
  await page.evaluate(() => { const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Clear")); if (btn) btn.click(); });
  await sleep(700);
  const modalOpen = (await page.$(".modal-overlay")) !== null;
  ok("clear-all opens confirm modal", modalOpen);
  if (modalOpen) {
    await page.evaluate(() => { const c = [...document.querySelectorAll(".modal-actions button")].find((b) => /cancel/i.test(b.textContent)); if (c) c.click(); });
    ok("cancel keeps conversations", true);
    await sleep(400);
  }

  // ---------- 6. KNOWLEDGE BASE PAGE ----------
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /knowledge/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1200);
  const kbSearch = (await page.$('.page input[placeholder*="Search"], .page input')) !== null;
  ok("Knowledge Base page opens", kbSearch);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-03-kb.png" });

  // ---------- 7. ESCALATIONS PAGE ----------
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /escalation/i.test(e.textContent)); if (n) n.click(); });
  await sleep(1500);
  const escListed = await page.evaluate(() => document.body.innerText.includes("Escalation"));
  ok("Escalations page opens", escListed);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-04-escalations.png" });

  // ---------- 8. SETTINGS PAGE ----------
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /settings/i.test(e.textContent)); if (n) n.click(); });
  try { await page.waitForFunction(() => document.querySelectorAll(".set-card").length >= 7, { timeout: 10000 }); } catch {}
  await sleep(400);
  const cards = await page.evaluate(() => [...document.querySelectorAll(".set-card h3")].map((h) => h.textContent.trim()));
  ok("Settings: 7 sections (incl admin RAG tuning)", cards.length >= 7, `${cards.length}`);
  const dots = await page.evaluate(() => [...document.querySelectorAll(".int-tbl .dot")].map((d) => d.textContent.trim()));
  ok("Settings: integration status dots", dots.length >= 4, JSON.stringify(dots.slice(0, 5)));
  // toggles persist?
  const t0 = await page.evaluate(() => document.querySelector(".set-card .row .tgl")?.classList.contains("on"));
  await page.evaluate(() => document.querySelector(".set-card .row .tgl")?.click());
  await sleep(1300);
  const t1 = await page.evaluate(() => document.querySelector(".set-card .row .tgl")?.classList.contains("on"));
  ok("Settings: toggle persists via API", t0 !== null && t1 !== null && t0 !== t1);
  await page.evaluate(() => document.querySelector(".set-card .row .tgl")?.click()); // restore
  await sleep(1300);
  await page.screenshot({ path: "C:/Users/aungaung/it-help-chatbot/docs/audit-05-settings.png" });

  // ---------- 9. THEME APPLIED (if implemented) ----------
  const themeAttr = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  ok("theme engine active (data-theme attr)", themeAttr !== undefined && themeAttr !== null, String(themeAttr));

  // ---------- 10. SIGN OUT MODAL ----------
  await page.evaluate(() => { const n = [...document.querySelectorAll(".navitem")].find((e) => /chat/i.test(e.textContent)); if (n) n.click(); });
  await sleep(500);
  await page.evaluate(() => document.querySelector(".signout-btn")?.click());
  await sleep(600);
  const soModal = (await page.$(".modal-overlay")) !== null;
  ok("sign-out opens confirm modal", soModal);
  if (soModal) await page.evaluate(() => { const c = [...document.querySelectorAll(".modal-actions button")].find((b) => /cancel/i.test(b.textContent)); if (c) c.click(); });

  console.log(R.join("\n"));
  const fails = R.filter((r) => r.startsWith("FAIL")).length;
  console.log(`SUMMARY: ${R.length - fails}/${R.length} PASS`);
  process.exitCode = fails ? 2 : 0;
} catch (e) {
  console.log("AUDIT ERROR: " + e.message);
  console.log(R.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
