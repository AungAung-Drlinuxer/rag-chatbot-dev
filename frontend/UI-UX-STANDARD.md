# Desktop UI/UX Standard — Enterprise Quality Specification

> **Target bar:** Stripe · Linear.app · Vercel Dashboard · Notion
> Binding requirement document for every UI change in `desktop/`.
> Enforced by: PR screenshot review (user bar), ESLint, and the computed-style
> harness in `scripts/`. Every rule below is TESTABLE — "nice" is not a criterion.

Status legend: ✅ implemented & verified · ⚠️ partial · ❌ gap (backlog item B-n)

---

## 1. Color System & Typography (Visual Identity)

### 1.1 Design tokens — no direct hex in components
| Requirement | Standard | Status |
|---|---|---|
| Token architecture | ALL colors/fonts/radii live as CSS variables in `src/styles.css`; light `:root` + `[data-theme="dark"]` blocks, bridged to utilities via Tailwind v4 `@theme inline` | ✅ (`--background`, `--primary`, `--sidebar-*`, `--radius-xs…xl`) |
| Dual-theme parity | Any token retune edits BOTH theme blocks in one commit — light mode never drifts | ✅ rule, enforced in review |
| No magic hex in JSX | Components consume `bg-[var(--token)]` / semantic classes; one-off hex allowed ONLY in tokens file | ⚠️ legacy `bg-[#0A1628]`, `bg-[#2563eb]` brand chips → **B-1: tokenize** |

### 1.2 Palette
| Requirement | Standard | Status |
|---|---|---|
| Neutral base | Rich slate/zinc neutrals (NOT generic blue-gray "Bootstrap" look) — main `#070B14`(dark)/`#FFF`(light), sidebar deeper two-tone separation | ✅ v0.21.65 pattern |
| Accent discipline | Exactly ONE primary accent (indigo `#4F46E5`) + one semantic family (sky) for active states; emerald/amber/red reserved for status semantics only | ✅ |
| Elevation over borders | **Borderless bar**: cards = surface tone + soft shadow + tinted hairline ring (`inset 0 0 0 1px color-mix(...primary 5%...)`); no 1px visible borders | ✅ (accepted after 5 review rounds — do NOT regress) |

### 1.3 Typography
| Requirement | Standard | Status |
|---|---|---|
| Typeface | **Inter** (Google Fonts preconnect + fallback stack), never system-ui first | ✅ |
| Strict scale | Exactly one type ramp: `caption 10 / label 11 / body 12–13 / subhead 14 / h2 16 / h1 20 / display 24` px. Arbitrary `text-[9px]` etc. are a smell — consolidate into the ramp | ⚠️ 9/10/11px scattered (~40 sites) → **B-2: scale cleanup** |
| Hierarchy roles | Page title = `PageHeader` h1 · section = SectionCard title · KPI value = tabular-nums semibold | ✅ primitives exist (`components/ui/page.tsx`) |

## 2. Layout & Navigation Architecture

| Requirement | Standard | Status |
|---|---|---|
| Shell | Sidebar → content grid; single nav surface per page (never two sidebars; no "Back to chat" buttons — sidebar is THE nav path) | ✅ |
| Capability-aware nav | Locked items visible with explicit deny-reason popover (v0.21.57) | ✅ `components/PageSidebar.tsx` |
| Collapsible sidebar | Linear/Notion-style collapse to icon rail, persisted (`ith.sidebar`), toggle in foot + shortcut **Cmd/Ctrl+B** | ❌ **B-3: implement** (desktop + web shell; ChatPage sidebar included) |
| Active item | Subtle glow highlight (`--sidebar-active-bg` navy/sky pair) | ✅ |
| Command palette | **Cmd/Ctrl+K** universal search — conversations + KB articles + page jump, arrow-key navigable, Esc closes | ⚠️ palette exists Chat-scoped → **B-4: global shell-level, add pages/KB results** |
| Breadcrumbs | Header shows `Workspace › <Page> [<sub-view>]` on nested views (ticket detail, article edit) | ❌ **B-5: PageHeader breadcrumbs slot** |
| Profile quick action | Sidebar foot: gradient avatar + name + role chip + visible-text Sign Out | ✅ |
| Notifications | Bell trigger w/ unread dot polling admin-relevant events (pending approvals, LDAP gates) | ❌ **B-6** |

## 3. Card System & Data Presentation

| Requirement | Standard | Status |
|---|---|---|
| Bento grid | Dashboard KPI row = asymmetrical bento (`md:grid-cols-2 xl:grid-cols-4` + span-2 feature panel), not uniform grid | ✅ KpiCard row + charts; **B-7: give 1 hero card `xl:col-span-2`** |
| Micro-interactions | Hover: shadow lift + 2% accent wash + `translate-y-[-1px]`; global transition `150ms ease-in-out` (range 150–200ms). Glassmorphism (`backdrop-blur`) only on topbar/drawer overlays | ⚠️ hover states exist; no unified timing token → **B-8: `--dur-fast:150ms` token + apply** |
| Data density | KPI cards carry sparkline + delta pill + description; tables = high-density rows, sticky header, column sort, pagination, status badges (pill), quick-action `⋯` menu (Radix trigger as SIBLING, per skill rule 21) | ✅ Dashboard/KPI · ⚠️ ticket table sort → **B-9** |
| Status badges | One shared badge vocabulary: `STATUS_META/PRIORITY_META` (feature model) — pill style, tinted bg, never raw enums | ✅ |

## 4. UX — Loading, Empty, Motion

| Requirement | Standard | Status |
|---|---|---|
| Skeletons | `Skeleton` shimmer matching content pattern (table rows, card grid) during fetch — spinners banned except streaming dots (chat TypingIndicator is content, not a spinner) | ✅ Skeleton in 4 pages → **B-10: audits/conversations sweep** |
| Empty states | Icon chip + headline + explanation + **active CTA button** (Users page is the pattern); never a bare text line | ⚠️ Tickets/Conversations text-only → **B-11: shared `EmptyState` from `components/ui/page.tsx`, wire all 5 list pages** |
| Streaming feel | SSE stage text in indicator (no >1s silence), optimistic user bubble, token-by-token render | ✅ v0.16.4 contract |
| Motion budget | framer-motion spring only for list entry/message reveal; respect `ith.animations=0` (`animations-off` class) globally | ✅ |
| Keyboard-first | Enter=send, Shift+Enter=newline, Esc=closes modals, Cmd+K palette, Tab order = visual order; all icon buttons have `title`/`aria-label` | ⚠️ → **B-12: a11y pass** |
| Toast feedback | Mutations acknowledged via app toast (2.5s, borderless, bottom-right) — `useToast` single implementation | ✅ (this pass) |

## 5. Responsive Floor (non-negotiable, every pass)

- ≥1025px inline sidebar · ≤1024px hamburger + off-canvas drawer (blurred backdrop, nav-click closes) · ≤640px single column, inputs `font-size:16px` (iOS zoom guard)
- One global gutter constant (16px) at all widths; `scrollWidth > clientWidth` overflow must be 0 on every route at 1366/1024/800/375 — harness `scripts/measure-page-padding.mjs`
- Native `<select>` dark-theme option styling handled centrally in styles.css (v0.21.42) ✅

## 6. Icon & Component Discipline

- **lucide SVG components only — emoji banned** in nav/buttons/confirmations (mass-swap done; CI grep `[\x{1F300}-\x{1FAFF}]` in JSX = fail → **B-13: add to lint config**)
- shadcn primitives (`components/ui/*`) are the base — pages do not re-skin Button/Dialog/Select locally
- Every page uses `PageShell/PageHeader/SectionCard` — drift is a review-block (v0.21.0 rule)

## 7. Verification (Definition of "Done" for UI work)

1. `npx tsc --noEmit` 0 · `npx eslint src` 0 · `npm test` green
2. Computed-style harness asserts: opaque card bg, theme flip, drawer transform, token presence — not class-name presence
3. **Screenshot every touched page × both themes** (`scripts/*.mjs`), vision-review against the named apps before PR
4. Live-verify after deploy: served bundle hash + unique string + puppeteer pass

---

## Backlog ledger (this spec → issues)

| ID | Item | Size |
|---|---|---|
| B-1 | Tokenize remaining literal hex in JSX | S |
| B-2 | Type-scale consolidation (kill 9px, define ramp) | M |
| B-3 | Collapsible sidebar + Cmd/Ctrl+B + persisted state | M |
| B-4 | Command palette → shell-level (pages + KB + conversations) | M |
| B-5 | Breadcrumbs slot in PageHeader (detail views) | S |
| B-6 | Notification bell (approvals/LDAP pending) | M |
| B-7 | Bento hero card (col-span-2 usage/domain panel) | S |
| B-8 | `--dur-fast/--dur-slow` tokens, 150–200ms unified | S |
| B-9 | Ticket table column sorting | S |
| B-10 | Skeletons on audits/conversations | S |
| B-11 | Shared EmptyState + CTA on all list pages | S |
| B-12 | a11y pass (focus-visible ring, aria labels, tab order) | M |
| B-13 | Emoji-in-JSX lint rule | S |

Rules B-1…B-13 map 1:1 to the BRD sections above; implement in dependency order
(B-8 tokens → B-3/B-4 shell → B-11/B-12 polish). Update the Status column in the
same PR that closes each item.
