# UI audit — how the nine pages measure against the page contract

Date: 2026-11-13 · frontend `dev-1.11.93` · method: static scan of each page and its feature
folder (`PageHeader` / `EmptyState` / `ErrorState` usage, `aria-label` counts, `sticky`, mobile
blocks, `URLSearchParams` in routing), plus live checks on the dev cluster for the pages touched
this week (Settings, Tickets, Overview).

Legend: ✅ meets the clause · ⚠️ partial or not proven · ✗ missing · n/a not applicable.

## Scorecard

| Clause | Chat | Overview | Knowledge | Tickets | Domains | Users | Conversations | Audit log | Settings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Header (h1 + purpose + one primary) | n/a | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 Spacing / type scale | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 Four states | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✗ |
| 4 Table quality | n/a | n/a | ⚠️ | ✅ | n/a | ✅ | ⚠️ | ✅ | n/a |
| 5 Forms | ✅ | n/a | ✅ | ✅ | ✅ | ✅ | n/a | n/a | ✅ |
| 6 Destructive safety | n/a | n/a | ⚠️ | ⚠️ | ⚠️ | ✅ | n/a | n/a | ⚠️ |
| 7 Accessibility / keyboard | ⚠️ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ⚠️ | ✅ |
| 8 Responsive | ⚠️ | ⚠️ | ⚠️ | ✅ | ✗ | ✅ | ⚠️ | ⚠️ | ✅ |
| 9 URL state | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| 10 Code-split / perf | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Clause 10 passes everywhere for the same reason: all nine routes are `lazyPage` imports in
`App.tsx:46-53`. It fails nowhere yet because no list is large enough to need virtualisation —
Knowledge is the one to watch (`virtual` already referenced there).

## What the scan actually found

**URL state is missing on every page.** The hash router carries the route id only
(`#/tickets`, `#/?c=<conversation>`). No page writes filters, sort, tab or page into the URL:
`URLSearchParams` appears in the codebase twice, both times to build an API query
(`KnowledgePage.tsx:472`, `features/audits/api.ts:5`), not to read `location`. Consequence:
refreshing after filtering Tickets, Users or Conversations returns an unfiltered list, and a
link to "the open tickets on page 3" cannot be sent to anyone.

**Settings has no page-level states.** `SettingsPage.tsx` renders the rail and the section
immediately; each section owns its own loading and error handling (Connections card, SMTP, AI
service do this well; Preferences and Retention assume their fetch succeeds). There is no
`EmptyState`/`ErrorState` at the page level, so a failed settings fetch paints defaults that look
like real values — the most dangerous kind of wrong answer on a settings page.

**Tables are uneven.** Tickets is the reference for sorting and mobility: `aria-sort` on every
sortable `<th>`, 40px rows, a pager, and a card list under `md` (`TicketTable.tsx:111`, `:274`).
Users and Audit log both had a card list but no column sorting; and none of the three actually
had a sticky header, because the wrapper was `overflow-x-auto` — a sticky `<thead>` only sticks
when its nearest scroll container scrolls vertically. `.table-viewport` now gives Users and Audit
log a capped, vertically scrolling box (and the header with it); Tickets keeps its board layout
and still does not stick. Domains has no table at all (cards), which is fine — but it also
has no `sticky` and no mobile block, so its card grid relies on default wrapping.

**Destructive actions use three different patterns.** Users builds a dialog; Settings calls the
browser's `window.confirm` (`AiServiceSettings.tsx:205`, `ConnectionsCard.tsx:180`,
`IntegrationsConfig.tsx:353`) — it cannot carry the design system, cannot show what will be lost,
and reads as "a website" rather than an application; and removing a ticket attachment fires
immediately with no confirmation at all (`TicketDetailPanel.tsx:589`). Server-side
`?confirm=<label>` guards some endpoints, but that is a backstop, not the interaction.

**A11y is good where it was touched and thin where it was not.** `aria-label` counts per feature:
Tickets 61, Settings 38, Chat 20, Users 19, Domains 17, Knowledge 15, Dashboard 9, Conversations 9,
Audit 6. `:focus-visible` is defined globally (`styles.css:1301`, `:1551`, dark variant `:1557`),
so the ring itself is consistent; the gap is labelling inside the four lowest features.

**No i18n layer.** No `i18next`/`react-i18next` dependency and no message catalogue — every string
is literal English in the component. For an APAC enterprise buyer this is usually the first
question after SSO.

**No 404 route.** `App.tsx:332` falls through to `case "chat"`, so an unknown hash silently shows
the chat page instead of saying the link is wrong.

## Fix list, in the order I would do it

| # | Fix | Why it matters | Effort |
| --- | --- | --- | --- |
| 1 | Page-level loading/error in Settings (one skeleton for the section body, `ErrorState` with retry) | defaults that look like stored settings are the worst failure on this page | S |
| 2 | URL state hook (`useUrlState`) for Tickets/Users/Conversations/Knowledge/Audit: filter, sort, page | shareable, refresh-safe links; no backend work | M |
| 3 | 404 route + "back to chat" | dead links should say so | S |
| 4 | Sticky header + mobile card list for Users and Audit log; column chooser for Users/Knowledge | the two tables people live in all day | M |
| 5 | Replace `window.confirm` in Settings and the bare attachment delete with the shared dialog | one destructive pattern, not three; native confirm cannot name what is lost | S |
| 6 | `aria-label` pass over Dashboard/Conversations/Audit icon buttons; `aria-live` for bulk results | clause 8 is pass/fail per screen | S |
| 7 | i18n skeleton: `en` catalogue + `my` placeholder, locale from user profile | enterprise procurement blocker | L |
| 8 | Playwright smoke on the nine routes (render + one write each) | the only way these clauses stay true | M |

Small (S) ≈ under a day, medium (M) ≈ 1–3 days, large (L) ≈ a week or more at this codebase's
current shape.

## Not audited here

- Contrast in both themes (measured previously; dark tokens in `styles.css` are the ones that
  regressed and were fixed in `d3caa11`).
- The Overview board's drag/resize behaviour (verified separately in `315706d`).
- Per-page performance numbers on a real device; the budgets in the standard are targets, not
  measurements.

## Settings, checked live (2026-11-13, `dev-1.11.95`)

The page failed four clauses when it was first scored. All four were fixed the same day; this is
the state after the fix, verified on the dev cluster.

| Clause | Verdict | Evidence |
| --- | --- | --- |
| 1 Header | ✅ | `h1 "Settings"`, purpose line, breadcrumb Workspace → Settings; the header action is a role badge, not a second primary |
| 2 Spacing / type | ✅ | padding and gaps on the 4/16 scale; hint text is `text-xs` (13px) — measured in the browser, was `text-[11px]` |
| 3 Four states | ✅ | `PrefsSkeleton` (`aria-busy`, `aria-label="Loading your preferences"`) while the fetch is in flight; `ErrorState` + **Try again** on failure; the preference controls are not rendered at all until the stored values arrive, so Save cannot write defaults. Verified by blocking `/api/settings` (error) and by adding 2.5s of latency (skeleton) |
| 4 Table | n/a | no table on this page |
| 5 Forms | ✅ | `Field` puts the label above the control and the hint below (`SettingsKit.tsx:94`) |
| 6 Destructive | ✅ | `window.confirm` replaced by `useConfirm()` (`components/ui/confirm.tsx`) in `AiServiceSettings`, `ConnectionsCard`, `IntegrationsConfig`; "Remove site" names the site, explains what is kept, and Cancel leaves it alone — verified live on a temporary Jira site |
| 7 A11y | ✅ | `nav aria-label="Settings sections"`, mobile `select` with its own label, `role="switch"` + `aria-checked`, 38 `aria-label`s, global `:focus-visible` |
| 8 Responsive | ✅ | 375 and 1024 measure 0 horizontal overflow; below `lg` the rail becomes a native picker (5 options, 56px tall) instead of a 1703px strip in a 343px viewport; the aside folds under at `xl` |
| 9 URL state | ✅ | section is `#/settings?tab=<id>` (`useSectionParam`); clicking Data retention rewrites the hash and a reload reopens that tab; an admin-only tab opened by a non-admin falls back to Preferences |
| 10 Perf | ✅ | lazy route; sections mount with the page, which is fine at this size |

Score: **9 pass, 1 n/a.** The section is shareable, the page cannot save a value the user never
saw, and every destructive action goes through the same dialog as the rest of the app.

## Page → archetype

Where each page sits in the seven shapes from `UI-STANDARD.md`, and what it still owes.

| Page | Archetype | State |
| --- | --- | --- |
| Tickets | List / queue (two-pane) | ✅ reference implementation |
| Users | List / queue | ✅ sortable headers with `aria-sort`, sticky header via `.table-viewport`, card list under `md`; column chooser still missing |
| Audit log | List / queue (chronological) | ✅ sticky header, card list, reset-filter action; no column sorting **by design** |
| Conversations | List / queue (chronological) | ⚠️ card list yes; no sticky header, filters report nothing about how many are loaded |
| Knowledge | List / queue | ⚠️ sticky header and paging, no column chooser, reason text is generic |
| Settings | Settings | ✅ rail/picker, section in the URL, loading gate, danger zone last |
| Overview | Dashboard | ⚠️ panels rearrange and survive reload; time range is not in the URL |
| Chat | Conversation surface | ✅ by exception — full height, composer pinned |
| Sign in / SSO | Auth | ✅ centred card, SSO first |

Copy is now one voice across the queues:
**"No <object> yet"** when the source is empty, **"No <object> match these filters"** plus
"`N` loaded, but none match" when a filter hides the list, and the same `Reset filters` action in
every one of them (previously Users said "No users found" with no count, Tickets "No tickets
found", Audit log said two different things on desktop and mobile).
