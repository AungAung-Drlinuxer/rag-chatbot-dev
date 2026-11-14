# UI standard — the page contract

What every page in this app has to satisfy before it is called done. The rules are written so
that a reviewer can check them by looking at one screen, not by arguing about taste. Where a rule
is already implemented, the file that owns it is named — the code is the source of truth, this
document is the agreement about what the code must do.

Scope: the nine signed-in pages (Chat, Overview, Knowledge, Tickets, Domains, Users,
Conversations, Audit log, Settings). Marketing pages, the login screen and the widget are out of
scope here.

---

## 1. Page anatomy

Every page is `PageShell` → `PageHeader` → content, in that order.

| Part | Rule | Owner |
| --- | --- | --- |
| Title | one `<h1>`, 24–28px, sentence case, names the object ("Tickets"), not the action ("Manage tickets") | `components/ui/page.tsx` |
| Purpose | one line under the title, ≤ 90 characters, says what the page is for | `PageHeader description` |
| Primary action | exactly one, top-right, verb-first ("New ticket", "Sync now") | `PageHeader actions` |
| Secondary actions | icon buttons or a menu, never a row of equal-weight buttons | `PageHeader actions` |
| Breadcrumb | only when the page sits under another (Settings → section) | `PageHeader breadcrumbs` |
| Toolbar | search / filters / view switch, left-aligned, below the header | page |
| Sticky header | the header stays put while the content scrolls, ≤ 64px tall | `PageShell` |

A page with two primary actions is not finished. If two actions matter equally, one is a link in
the content, the other is the button.

## 2. Grid and spacing

- Spacing steps: **4 / 8 / 12 / 16 / 24 / 32 / 48**. Nothing in between.
- Page padding: 16px (mobile) → 24px (≥ 640px) → 32px (≥ 1280px).
- Card padding 16–20px; gap between cards 16px; gap between sections 24–32px.
- Hierarchy is expressed with space and type size, not with borders and boxes.
- Content max-width 1440px, centred; a table may stretch, prose may not exceed 72ch.

## 3. Typography

Five sizes on a page, no more:

| Role | Size / weight | Use |
| --- | --- | --- |
| H1 | 24–28 / 600 | page title |
| H2 | 18–20 / 600 | section title |
| Body | 14 / 400 | everything readable |
| Meta | 12–13 / 400–500 | labels, hints, table headers |
| Micro | 10–11 / 600 uppercase | eyebrows, only above a group |

Line height 1.5 for body, 1.25 for headings. Numbers in tables use `font-variant-numeric:
tabular-nums`. Body text contrast ≥ 4.5:1 against its own surface, in **both** themes — the dark
tokens in `styles.css` are the ones that count, because dark is where contrast regressions have
actually shipped.

## 4. Data tables

The table is the product in an enterprise app. Minimum bar:

- Row height 40–44px (dense 32–36), header 40px, both from tokens not magic numbers.
- Header **sticky** inside the scroll container.
- Every visible column that can sort does sort, with `aria-sort` on the `<th>` and a visible
  arrow (`features/tickets/components/TicketTable.tsx` is the reference).
- Numeric column right-aligned; status column has an icon and a word, never colour alone.
- Row click opens the detail; the row is reachable by keyboard.
- Pagination or virtual scroll, with the total known ("1–50 of 312"). A bare "load more" on a
  queue is a defect: the user cannot tell how much work is left.
- Below `md` the table becomes a list of cards — horizontally scrolling a 7-column table on a
  phone is not a responsive design.
- Column visibility chooser once a table passes ~7 columns.

## 5. Forms

- Label above the field, always visible; placeholder is an example, never the label.
- Field height 36–40px (44px on touch), 14px text, 8px radius.
- Required marked once at the top ("All fields required unless marked optional"), not with ten
  asterisks.
- Validation on blur and on submit; the message sits directly under its field and says how to fix
  it, not that it is wrong.
- The first invalid field receives focus on submit.
- Destructive or irreversible changes need the object's name typed or a checkbox, not just
  "Are you sure?".

## 6. The four states

Every data region answers all four, and none of them may be a blank panel:

| State | Requirement |
| --- | --- |
| Loading | skeleton shaped like the real content, shown only after ~300ms |
| Empty | what is missing, why, and the one action that fixes it (`EmptyState`) |
| Error | what failed, a retry, and a request/trace id (`ErrorState`) |
| No permission | the capability that is missing and who can grant it (`AccessRestricted`) |

A page that renders `null` while loading, or an empty white card on error, fails the contract
regardless of how good it looks when the data arrives.

## 7. Destructive actions and feedback

- Delete / disable / revoke: confirmation dialog naming the object, danger button on the right,
  focus starts on Cancel.
- Undo beats confirmation where the action is reversible (toast with Undo, 8s).
- Every write ends in feedback: inline "Saved" with a timestamp, or a toast. Silent success is a
  bug — the user presses the button again.
- Errors from writes stay on screen until dismissed or fixed; they are never a 3-second toast.

## 8. Accessibility and keyboard

- Every icon-only control has an `aria-label`; every toggle has `role="switch"` and
  `aria-checked`.
- Focus is always visible: 2px ring, 2px offset (`:focus-visible` in `styles.css`).
- Tab order follows visual order; a modal traps focus and returns it to the trigger on close.
- `Esc` closes, `Enter` submits, `Ctrl/⌘+K` opens the palette (`App.tsx`).
- Live regions announce async results (`role="status"`), including counts after bulk actions.
- No state is conveyed by colour alone: status chips carry a word, charts carry labels.

## 9. Responsive, URL state, performance

- Breakpoints: 640 / 1024 / 1280. Below 640: one column, 44px touch targets, dialogs become
  bottom sheets (`styles.css`, `@media (max-width: 639px)`).
- **Page state that a user would want to share lives in the URL**: tab, filters, sort, page.
  Refresh must not lose work, and a link must open what the sender saw.
- Routes are code-split (`lazyPage` in `App.tsx`); lists over 100 rows virtualise.
- Budgets: LCP < 2.5s, CLS < 0.1, INP < 200ms on the dev cluster.
- Unknown routes render a 404 page with a way back, never a silent redirect to somewhere else.

---

## Review checklist

Copy into a PR description and tick what the change proves:

```
[ ] PageHeader: one h1, one purpose line, one primary action
[ ] Spacing on the 4/8/12/16/24/32 scale; content max-width respected
[ ] Loading skeleton, empty state, error state, no-permission state
[ ] Table: sticky header, sortable with aria-sort, pager with totals, mobile cards
[ ] Forms: label above, error under field, focus on first invalid
[ ] Destructive actions confirm; every write gives feedback
[ ] Icon buttons labelled; focus visible; keyboard path works
[ ] URL carries tab/filter/sort/page
[ ] Checked at 375, 768, 1024, 1440 and in both themes
```

## Known, deliberate exceptions

- **Chat** is a surface, not a document: no `PageHeader`, the composer is the primary action, and
  the layout is locked to the viewport (`PageShell fill`). It still owes every other clause.
- **Overview** is a board of panels the user arranges; panel chrome is exempt from the spacing
  scale, panel *content* is not.
