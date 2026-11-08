# Overview

The landing page of the assistant. It answers three questions at a glance: *is anything
broken*, *what did the assistant do*, and *what is it costing*.

## The board is fixed

There is no arrange mode. The page uses the same shell as every other screen —
`PageHeader` (breadcrumbs, eyebrow, icon, role badge, reporting window, Refresh, reports) and
then a 12-column row grid — so it reads like Knowledge, Tickets, Users and Domains.

```
Needs attention                        12
Tokens, cost & latency                 12   (administrators)
Volume KPIs                            12
Conversations over time                 8   +  Answer quality                4
Tokens & cost per day                   6   +  Tokens by model               6
Cost by model                           6   +  Knowledge by domain           6
Workspace                               6   +  System health                 6
Guardrail events                       12   (administrators)
```

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
