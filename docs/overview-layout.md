# Overview board — the Grafana-like grid

## The model

A panel is data, and its geometry is part of that data:

```json
{ "id": "trend", "type": "trend", "title": "", "span": 8, "x": 0, "y": 2, "h": 5, "options": {} }
```

| field | meaning |
|---|---|
| `span` | width in columns (3–12 of 12) |
| `x` | column the panel starts at (0–11) |
| `y` | grid row it starts at |
| `h` | height in rows (2–12) |

`GET/PUT/DELETE /api/dashboard/layout` stores this per user. A layout saved before the board
became positionable has no `x`/`y`/`h`; the client assigns them at render time by shelf-packing
in array order — which is exactly the old stacked board — and writes them back on the next save.
The API clamps geometry rather than rejecting it, so a stale client loads a usable board
instead of a 422 that hides the page.

## Interactions

- **Move** — drag a panel's header. A dashed ghost shows the target cell; on drop the panel
  takes that cell and anything it lands on is pushed **down**, never sideways.
- **Resize** — drag the bottom-right corner, or use the width/height selects in the header.
- **Configure** — the pencil opens the panel editor: type, title, width, height, and the options
  that type actually uses (`limit` for lists, `body` for notes).
- **Duplicate / remove** — copy lands directly below the original.
- **Keyboard / no-mouse** — the header's arrow buttons slide a panel one panel-width left or
  right; the selects set size exactly.
- **Save** — nothing is written until *Save layout*; *Cancel* discards, *Reset* deletes the
  saved layout and restores the role default.

Below `sm` the canvas is not used at all: panels stack in reading order and size to their
content, because a 12-column grid on a phone is a column of clipped cards.

## Why these rules

- **Gravity** (everything floats up) means a drag never leaves a permanent hole, which is what
  makes free placement usable without a "compact" button.
- **Vertical-only pushing** keeps the columns an operator deliberately built; a sideways shuffle
  after every drop makes a board impossible to reason about.
- **The dragged panel wins its cell** — a generic "push the lower one down" pass would shove the
  panel you just dropped away from where you dropped it.
- **Fixed row height** is what makes resize meaningful; a panel's body scrolls rather than
  growing the board, so heights stay comparable across rows.
- Geometry maths is pure (`panels/grid.ts`) and tested without a DOM; the interaction is one
  render on drop, with the intermediate frames done as a CSS transform, so dragging does not
  re-render every chart on the page.
