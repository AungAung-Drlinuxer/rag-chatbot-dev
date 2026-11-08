# Overview

The landing page of the assistant. It answers three questions at a glance: *is anything
broken*, *what did the assistant do*, and *what is it costing*.

## One screen

The board is sized to the viewport, not to its content: the shell is `100dvh`, the page is a
flex column, and the five bands take the leftover height by weight. On a 1920×1080 desktop
every band is visible at once and there is **no page scroll**; at 1440×900 it still fits
(measured: document height == viewport height). Below `lg`, or in a very short window, the
page falls back to scrolling — a phone must not be squeezed into a desktop board.

```
Band 1  Needs attention                    4  +  Volume KPIs                 8
Band 2  Tokens, cost & latency             3  +  Conversations over time    6  +  Outcome mix   3
Band 3  Tokens & cost per day              4  +  Tokens by model            4  +  Cost by model 4
Band 4  Knowledge by domain                4  +  Workspace                  4  +  System health 4
Band 5  Guardrail events                  12
```

There is no arrange mode: the page uses the same shell as every other screen — `PageHeader`
(breadcrumbs, eyebrow, icon, role badge, reporting window, Refresh, Export CSV, Report),
with `dense` set so the header costs one compact row.

## Height policy

- Bands use `minmax(<min>, <weight>fr)`, so a chart never collapses to a strip: if the
  window is shorter than the minimums, the board scrolls **inside its own frame** (header and
  footer stay put) instead of clipping a panel.
- Lists and tables scroll inside their card; a card is never taller than its band.
- Charts measure their box (`useChartSize` + `ResizeObserver`) and redraw at that size.

Two panels were removed by request: **Needs review** and **Recent tickets**. Their work
belongs on the Conversations and Tickets pages; on the board they only made it longer.

## Roles

| Role | Board |
| --- | --- |
| `admin` | `DEFAULT_LAYOUT_ADMIN` — operations + usage/spend/guardrails |
| everyone else | `DEFAULT_LAYOUT` — operations only |

The usage endpoints refuse a non-administrator, so the admin panels are absent rather than
empty: an agent sees no cost figure at all.

## Panel heights

Each type has a natural height (`PANEL_HEIGHTS`, in 92 px rows). Bodies are flex columns
sized by their cell, lists spend the leftover height on the list, and charts measure their
box (`useChartSize` + `ResizeObserver`) and redraw — they never scale a fixed picture.

## Reporting window

The picker commits on **Apply range**, not on every keystroke, and the footer names the
window the backend *actually* returned (it clamps over-long spans). All panels read that one
window through a single shared fetch.

## Honest failure

A failed load shows `—` plus a banner and a Retry; it never draws a zero. A refused usage
endpoint says it needs administrator permission instead of "$0.00".

## What is not here

`dashboard_layouts` and `/api/dashboard/layout` still exist server-side, but the page no
longer reads or writes them: a saved layout can't silently differ from the documented board.
