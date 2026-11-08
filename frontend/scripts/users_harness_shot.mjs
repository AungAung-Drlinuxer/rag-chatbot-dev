// Screenshot + MEASURE the Users (workspace members) page.
//
// Why a harness instead of the running app: the users directory is admin-only and
// verification must not sign in as anyone. The harness renders the real page
// component with `fetch` stubbed to fixtures shaped like the endpoint returns
// (see src/__users_harness__.tsx).
//
// What it MEASURES rather than looks at — "the page matches the mockup" is a claim
// that has to be arithmetic where it can be:
//   1. no JS errors, no unhandled rejections
//   2. no horizontal overflow at 1600px
//   3. the summary cards are FOUR EQUAL columns on one row (the mockup's 4-up grid)
//      and each number equals the count computed from the fixture
//   4. the toolbar offers exactly the states the data actually has
//   5. pagination is real: page 1 shows 10 rows with the right range text, the pager
//      changes the rows, the range text and the page count
//   6. filtering is real: search and status both narrow the rows
//   7. no cell is invented: a user with no join date reads "—", never a made-up date
//   8. the edit overlay is live: the role select changes the capability preview
//      arithmetically (Administrator 5/5 -> User 2/5) and saving writes the role
//   9. destructive actions do NOTHING until the confirm dialog is confirmed
//  10. both themes render (the mockup is dark-only; the app is not)
//
// Usage (dev server only): node scripts/users_harness_shot.mjs
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.env.SHOT_DIR || ".shots";
const PORT = 5242;
const BASE = `http://localhost:${PORT}/users-harness.html`;

const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(existsSync) ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

mkdirSync(OUT, { recursive: true });

const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
  shell: true, stdio: "pipe", cwd: process.cwd(), detached: true,
});
dev.stdout.on("data", () => {});
dev.stderr.on("data", (d) => { const s = d.toString(); if (/error|Error/.test(s)) process.stderr.write(s); });

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disk-cache-size=1"],
});

try {
  if (!(await waitForServer(BASE))) throw new Error("vite dev server never came up");

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  const errors = [];
  const bad = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico|status of 404/.test(m.text()) && !/\/api\//.test(m.text())) return;
    errors.push(m.text());
  });
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  // --- helpers evaluated in the page -----------------------------------------
  const reqs = () => page.evaluate(() => window.__USR_REQS__.map((r) => `${r.method} ${r.path} ${r.body}`));
  const clearReqs = () => page.evaluate(() => { window.__USR_REQS__.length = 0; });
  const rows = () => page.evaluate(() => document.querySelectorAll("table tbody tr").length);
  const footer = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("span")].map((s) => s.textContent || "").find((t) => /^Showing .* of .* users$/.test(t)) || "");
  const closeDrawer = async () => {
    const closed = await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Close"]');
      if (!(b instanceof HTMLElement)) return false;
      b.click();
      return true;
    });
    await sleep(250);
    return closed;
  };
  const openUser = async (label) => {
    const ok = await page.evaluate((needle) => {
      const row = [...document.querySelectorAll("table tbody tr")].find((tr) => (tr.textContent || "").includes(needle));
      if (!row) return false;
      const edit = [...row.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Edit");
      if (!(edit instanceof HTMLElement)) return false;
      edit.click();
      return true;
    }, label);
    await sleep(350);
    return ok;
  };
  const confirmDialog = async () => {
    const present = await page.evaluate(() => !!document.querySelector('[data-slot="alert-dialog-content"]'));
    if (present) {
      await page.evaluate(() => {
        const b = document.querySelector('[data-slot="alert-dialog-action"]');
        if (b instanceof HTMLElement) b.click();
      });
      await sleep(450);
    }
    return present;
  };

  for (const theme of ["dark", "light"]) {
    await page.goto(`${BASE}?theme=${theme}`, { waitUntil: "networkidle2", timeout: 45000 });
    await page.waitForSelector("table tbody tr", { timeout: 15000 });
    await sleep(700);
    await clearReqs();

    await page.screenshot({ path: `${OUT}/users_${theme}.png`, fullPage: true });

    if (theme === "light") {
      const light = await page.evaluate(() => {
        const body = getComputedStyle(document.body).backgroundColor;
        const h1 = getComputedStyle(document.querySelector("h1")).color;
        const cards = [...document.querySelectorAll('[data-slot="summary-card"]')].map((c) => Math.round(c.getBoundingClientRect().top));
        return { body, h1, cardRows: [...new Set(cards)].length };
      });
      check("light theme renders with light surfaces", light.body !== "rgba(0, 0, 0, 0)", JSON.stringify(light));
      check("light theme keeps the 4-up card row", light.cardRows === 1, `rows=${light.cardRows}`);
      continue;
    }

    const realBad = bad.filter((b) => !/\/favicon\.ico$/.test(b));
    check("no JS errors (favicon 404 excluded)", errors.length === 0, errors.slice(0, 3).join(" | "));
    check("no failed requests except the harness favicon", realBad.length === 0, realBad.slice(0, 3).join(" | "));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check("no horizontal overflow at 1600px", overflow <= 0, `overflow=${overflow}px`);

    // --- header ---------------------------------------------------------------
    const header = await page.evaluate(() => ({
      crumb: document.querySelector('nav[aria-label="Breadcrumb"]')?.textContent || "",
      eyebrow: /ADMINISTRATION/.test(document.body.innerText),
      h1: document.querySelector("h1")?.textContent || "",
      desc: /Manage workspace members and their access\./.test(document.body.innerText),
      badge: /12 users/.test(document.body.innerText),
      addPrimary: (() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Add user/.test(x.textContent || ""));
        return b ? getComputedStyle(b).backgroundColor : "missing";
      })(),
      exportSecondary: (() => {
        const b = [...document.querySelectorAll("button")].find((x) => /Export CSV/.test(x.textContent || ""));
        return b ? getComputedStyle(b).backgroundColor : "missing";
      })(),
    }));
    // The page used to carry its own breadcrumb; it now lives in the shell's TopBar, which
    // topbar_harness_shot.mjs verifies across all 8 pages. So the assertion is inverted: this
    // page must NOT duplicate it.
    check("page does not duplicate the shell breadcrumb",
      !/Workspace\s*\/\s*Users/.test(header.crumb), `"${header.crumb}"`);
    check("eyebrow + h1 + description", header.eyebrow && header.h1 === "Users" && header.desc, `h1="${header.h1}"`);
    check("header carries the member-count badge", header.badge);
check('"Add user" is the primary (brand) button', /rgb\(139, 92, 246\)|rgb\(124, 58, 237\)/.test(header.addPrimary), `bg=${header.addPrimary}`);
check('"Export CSV" is secondary, not brand-filled', !/rgb\(139, 92, 246\)|rgb\(124, 58, 237\)/.test(header.exportSecondary), `bg=${header.exportSecondary}`);

    // --- summary cards: 4-up, equal width, numbers from the data ---------------
    const fixture = await page.evaluate(() => window.__USR_FIXTURE__);
    const cards = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-slot="summary-card"]')];
      return nodes.map((n) => {
        const spans = [...n.querySelectorAll("span")].map((s) => s.textContent || "");
        const label = spans[0] || "";
        const value = (n.querySelector(".text-3xl")?.textContent || "").trim();
        return { label, value, top: Math.round(n.getBoundingClientRect().top), width: Math.round(n.getBoundingClientRect().width) };
      });
    });
    const tops = [...new Set(cards.map((c) => c.top))];
    const widths = [...new Set(cards.map((c) => c.width))];
    check("4 summary cards, one row, equal width", cards.length === 4 && tops.length === 1 && widths.length === 1,
      `n=${cards.length} rows=${tops.length} widths=${JSON.stringify(widths)}`);
    const byLabel = Object.fromEntries(cards.map((c) => [c.label, c.value]));
    check("card numbers equal the counts in the loaded list",
      byLabel["Total users"] === String(fixture.total) &&
      byLabel["Active users"] === String(fixture.active) &&
      byLabel["Administrators"] === String(fixture.admins) &&
      byLabel["Inactive"] === String(fixture.inactive),
      `rendered=${JSON.stringify(byLabel)} fixture=${JSON.stringify(fixture)}`);

    // --- panel heading + toolbar ---------------------------------------------
    const panel = await page.evaluate(() => {
      const h2 = [...document.querySelectorAll("h2")].map((n) => n.textContent || "");
      const status = [...document.querySelectorAll('select[aria-label="Status"] option')].map((o) => o.textContent);
      const role = [...document.querySelectorAll('select[aria-label="Role"] option')].map((o) => o.textContent);
      const search = document.querySelector('input[aria-label="Search users"]');
      const reset = [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Reset");
      const panelNode = document.querySelector('[data-slot="page-content"] section');
      return {
        h2,
        status,
        role,
        reset,
        minWidth: search ? getComputedStyle(search).minWidth : "missing",
        panelText: panelNode ? panelNode.textContent || "" : "",
      };
    });
    check('panel heading is "Workspace members"', panel.h2.includes("Workspace members"), JSON.stringify(panel.h2));
    check("panel carries a count badge", /12 users/.test(panel.panelText));
    check("toolbar: search + status + role + Reset",
      panel.status.length === 5 && panel.role.length === 5 && panel.reset,
      `status=${JSON.stringify(panel.status)} role=${JSON.stringify(panel.role)}`);
    check("status options cover exactly the states in the data",
      JSON.stringify(panel.status) === JSON.stringify(["All statuses", "Active", "Inactive", "Locked", "Disabled"]),
      JSON.stringify(panel.status));
    check("search input is at least 220px wide", parseFloat(panel.minWidth) >= 220, `min-width=${panel.minWidth}`);

    // --- table ----------------------------------------------------------------
    const table = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("table thead th")].map((th) => (th.textContent || "").trim());
      const firstRow = document.querySelector("table tbody tr")?.textContent || "";
      const carolRow = [...document.querySelectorAll("table tbody tr")].map((tr) => tr.textContent || "").find((t) => t.includes("carol")) || "";
      const bobRow = [...document.querySelectorAll("table tbody tr")].map((tr) => tr.textContent || "").find((t) => /Bob Brown/.test(t)) || "";
      const everyRowHasEdit = [...document.querySelectorAll("table tbody tr")].every((tr) =>
        [...tr.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Edit"));
      return { heads, firstRow, carolRow, bobRow, everyRowHasEdit };
    });
    check("table columns match the mockup",
      JSON.stringify(table.heads) === JSON.stringify(["User", "Department", "Role", "Status", "Last login", "Joined", "Actions"]),
      JSON.stringify(table.heads));
    check("every row offers an Edit action", table.everyRowHasEdit);
    check("user cell = handle + email", /@alice\s*·\s*alice@drlinuxer\.com/.test(table.firstRow), table.firstRow.slice(0, 80));
    check("never-logged-in reads as such (no invented date)", /Never logged in/.test(table.bobRow), table.bobRow.slice(0, 90));
    check("a missing join date renders as an em dash", /—/.test(table.carolRow) && !/\b20\d\d\b/.test(table.carolRow.replace(/@[^\s]*/g, "")),
      table.carolRow.slice(0, 90));

    // --- pagination -----------------------------------------------------------
    check("page 1 shows 10 rows", (await rows()) === 10, `rows=${await rows()}`);
    check('range footer "Showing 1 to 10 of 12 users"', (await footer()) === "Showing 1 to 10 of 12 users", await footer());
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "›");
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);
    check('pager "›" really pages', (await footer()) === "Showing 11 to 12 of 12 users" && (await rows()) === 2,
      `foot="${await footer()}" rows=${await rows()}`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "‹");
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);

    // --- filtering ------------------------------------------------------------
    await page.type('input[aria-label="Search users"]', "carol");
    await sleep(350);
    check("search narrows the table", (await rows()) === 1, `rows=${await rows()}`);
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-label="Clear search"]');
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);
    await page.select('select[aria-label="Status"]', "Locked");
    await sleep(350);
    const lockedText = await page.evaluate(() => document.querySelector("table tbody tr")?.textContent || "");
    check("status filter returns only that state", (await rows()) === 1 && /carol/.test(lockedText), `rows=${await rows()}`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Reset");
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);
    check("Reset restores the full list", (await rows()) === 10 && (await footer()) === "Showing 1 to 10 of 12 users",
      `rows=${await rows()} foot="${await footer()}"`);

    // --- note line ------------------------------------------------------------
    const note = await page.evaluate(() => document.body.innerText);
    check("note line states where the counts come from", /Counts are computed from the 12 members returned by\s*\/api\/users/.test(note.replace(/\s+/g, " ")));
    check("note line flags locked accounts", /1 locked account — Require admin action/.test(note));

    // --- geometry: the panel/note stack and the slide-over's placement ---------
    const geom = await page.evaluate(() => {
      const panel = document.querySelector('[data-slot="page-content"] section');
      const note = [...document.querySelectorAll("p")].find((p) => /Counts are computed from/.test(p.textContent || ""));
      const footer = [...document.querySelectorAll("span")].find((s) => /^Showing .* of .* users$/.test(s.textContent || ""));
      const rowsBox = document.querySelector("table tbody tr")?.getBoundingClientRect();
      return {
        noteBelowPanel: !!panel && !!note && note.getBoundingClientRect().top >= panel.getBoundingClientRect().bottom - 1,
        footerBelowRows: !!footer && !!rowsBox && footer.getBoundingClientRect().top >= rowsBox.bottom,
      };
    });
    check("note line sits under the panel, footer under the rows",
      geom.noteBelowPanel && geom.footerBelowRows, JSON.stringify(geom));

    // --- the edit overlay -----------------------------------------------------
    check("Edit opens the overlay", await openUser("alice"), "row button");
    const drawer = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return null;
      const rows = [...aside.querySelectorAll('[data-slot="permission-row"]')];
      return {
        hasAside: true,
        title: /User details/.test(aside.textContent || ""),
        heading: aside.querySelector("h2")?.textContent || "",
        roleValue: aside.querySelector('select[aria-label="Role"]')?.value || "",
        current: /Current: Administrator/.test(aside.textContent || ""),
        preview: /Preview: User/.test(aside.textContent || ""),
        enabled: rows.filter((r) => r.getAttribute("data-enabled") === "true").length,
        total: rows.length,
        source: /Active Directory|Local/.test(aside.textContent || ""),
        groups: /Domain Admins|admins/.test(aside.textContent || ""),
        saveDisabled: (() => {
          const b = [...aside.querySelectorAll("button")].find((x) => /Save access changes/.test(x.textContent || ""));
          return b ? b.disabled : null;
        })(),
      };
    });
    check("overlay = person header + account + role + directory + security",
      // Local rows carry name == username (the endpoint sets name = username for
      // local accounts), so the person header legitimately reads "alice".
      !!drawer?.hasAside && drawer.title && drawer.heading === "alice" && drawer.source && drawer.groups,
      JSON.stringify({ heading: drawer?.heading, source: drawer?.source, groups: drawer?.groups }));
    check("overlay starts on the current role with all 5 capabilities enabled",
      drawer?.roleValue === "Administrator" && drawer?.current && drawer?.enabled === 5 && drawer?.total === 5,
      `role=${drawer?.roleValue} enabled=${drawer?.enabled}/${drawer?.total}`);
    check("save is disabled until the role actually changes", drawer?.saveDisabled === true, `disabled=${drawer?.saveDisabled}`);
    const slide = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return null;
      const r = aside.getBoundingClientRect();
      return { width: Math.round(r.width), right: Math.round(r.right), viewport: window.innerWidth };
    });
    check("overlay is a right-hand slide-over (480px, flush to the edge)",
      slide?.width === 480 && slide?.right === slide?.viewport, JSON.stringify(slide));

    await page.select('aside select[aria-label="Role"]', "User");
    await sleep(350);
    await page.screenshot({ path: `${OUT}/users_overlay_dark.png` });
    const preview = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return null;
      const rows = [...aside.querySelectorAll('[data-slot="permission-row"]')];
      const b = [...aside.querySelectorAll("button")].find((x) => /Save access changes/.test(x.textContent || ""));
      return {
        preview: /Preview: User/.test(aside.textContent || ""),
        enabled: rows.filter((r) => r.getAttribute("data-enabled") === "true").length,
        total: rows.length,
        saveDisabled: b ? b.disabled : null,
      };
    });
    check("picking a role updates the preview LIVE (Administrator 5/5 -> User 2/5)",
      preview?.preview === true && preview?.enabled === 2 && preview?.total === 5,
      `preview=${preview?.preview} enabled=${preview?.enabled}/${preview?.total}`);
    check("save becomes available once the role changes", preview?.saveDisabled === false, `disabled=${preview?.saveDisabled}`);

    await clearReqs();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("aside button")].find((x) => /Save access changes/.test(x.textContent || ""));
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(450);
    const roleReqs = (await reqs()).filter((r) => /\/role/.test(r));
    check("saving writes the role through the real endpoint", roleReqs.length === 1 && /"role":"user"/.test(roleReqs[0]),
      JSON.stringify(roleReqs));

    await closeDrawer();

    // AD account: no local password form at all
    check("AD user overlay opens", await openUser("Bob Brown"));
    const adText = await page.evaluate(() => document.querySelector("aside")?.textContent || "");
    check("AD account shows the AD-managed callout and no password form",
      /Managed by Active Directory/.test(adText) && !/Update password/.test(adText));
    await closeDrawer();

    // Local account: the password form is real, and the callout says so
    check("local user overlay opens", await openUser("carol"));
    const localText = await page.evaluate(() => document.querySelector("aside")?.textContent || "");
    check("local account shows its own security callout + password form",
      /Local account/.test(localText) && /Update password/.test(localText));
    check("local callout does NOT claim nothing will change",
      !/No live account or password will be changed/.test(localText));

    // --- destructive actions are gated by the confirm dialog ------------------
    await clearReqs();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("aside button")].find((x) => /Deactivate account/.test(x.textContent || ""));
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);
    const dialogOpen = await page.evaluate(() => !!document.querySelector('[data-slot="alert-dialog-content"]'));
    await page.screenshot({ path: `${OUT}/users_confirm_dark.png` });
    const beforeConfirm = (await reqs()).filter((r) => /\/status/.test(r));
    check("Disable opens a confirm dialog and writes NOTHING yet",
      dialogOpen && beforeConfirm.length === 0, `dialog=${dialogOpen} requests=${JSON.stringify(beforeConfirm)}`);
    await confirmDialog();
    const afterConfirm = (await reqs()).filter((r) => /\/status/.test(r));
    check("confirming Disable writes the status through the real endpoint",
      afterConfirm.length === 1 && /"enabled":false/.test(afterConfirm[0]), JSON.stringify(afterConfirm));
    await closeDrawer();

    check("local user overlay reopens", await openUser("carol"));
    await clearReqs();
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("aside button")].find((x) => /Reset access/.test(x.textContent || ""));
      if (b instanceof HTMLElement) b.click();
    });
    await sleep(350);
    const resetBefore = (await reqs()).filter((r) => /reset-access/.test(r));
    check("Reset access is confirmed before it runs",
      (await page.evaluate(() => !!document.querySelector('[data-slot="alert-dialog-content"]'))) && resetBefore.length === 0,
      JSON.stringify(resetBefore));
    await confirmDialog();
    check("confirming Reset access calls the real endpoint",
      (await reqs()).filter((r) => /reset-access/.test(r)).length === 1);
    await closeDrawer();
  }
} finally {
  await browser.close();
  // Kill the whole process GROUP: `npx vite` spawns a grandchild that survives a plain
  // kill of the npx pid, keeps the stdout pipe open, and hangs node forever.
  try { process.kill(-dev.pid, "SIGKILL"); } catch { dev.kill("SIGKILL"); }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("  FAILED:");
  failed.forEach((f) => console.log(`    - ${f.name} (${f.detail})`));
  process.exitCode = 1;
}
