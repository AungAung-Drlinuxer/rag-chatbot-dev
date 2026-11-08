# Chat UI reference — extracted from the supplied mockup

The mockup was read by OCR (vision was unavailable), so every string below is transcribed
from the image rather than described. Image: 1280×856.

**It is a mockup of THIS app** — the header reads *IT HelpDesk / IT Knowledge Assistant*, the
sidebar footer is *aungaung · IT Staff*, and the answer content is PostgreSQL
troubleshooting. Treat it as the target design for the chat page.

## Layout at 1280px

| region | x range | width |
| --- | --- | --- |
| left sidebar | 0–275 | 275px |
| main column | 275–1010 | 735px |
| right panel | 1010–1280 | 270px |

## Top bar

`ITH` logo · **IT Knowledge Assistant** · *Get help from enterprise knowledge and IT experts*
Right side, four status chips: `APP OK` · `DB Connected` · `Vector DB Healthy` · `LLM Ready`

## Left sidebar

- Logo block, then **New Chat** as a full-width prominent button.
- Nav: `Dashboard` · `Knowledge` · `Routing` · `Tickets` · `Users` · `Settings`
- `History (20)`, grouped by `TODAY` / `YESTERDAY`, rows = title + relative age
  (`Database is down · 2m`, `How to reset password?`, `Reset my password · 1d`,
  `Database connection down · 2d`, `Standard troubleshooting... · 2d`)
- Footer: `aungaung` / `IT Staff` / `Sign Out`

## Main column

Header: `Analyzing your question...` on the left, `02:44 PM` on the right.

### RAG Pipeline — the defining element

```
RAG Pipeline   [Tracing live]                              ⏱ 20.6s
────────────────────────────────────────────────────────────────────
(1) Understanding 127ms ✓ → (2) Rewrite 76ms ✓ → (3) Retrieve 13ms
  → (4) Rerank 1ms ✓ → (5) Generate Running…
────────────────────────────────────────────────────────────────────
Execution Details                              4 completed      ▾
```

The five stages are **always visible** as a compact horizontal row; only the telemetry is
behind the expander. Stage names: `Understanding`, `Rewrite`, `Retrieve`, `Rerank`, `Generate`.

Expanded, each stage carries a one-line description:

- Understanding — *Input analyzed: "database is down"*
- Query rewrite — *Enhanced query with relevant keywords*
- Retrieval — *Found 5 relevant documents (hybrid search)*
- Reranking — *Top 3 results selected (confidence: 0.92)*

### Answer

Rendered as prose with code blocks (`sudo systemctl status postgresql`,
`sudo systemctl start postgresql`, `sudo journalctl -u postgresql -f`), closing with
*If the issue persists, please create an IT ticket in Jira or contact the infrastructure team.*

Answer footer: `Was this helpful?` · `Copy` · `Regenerate` · `Create Jira Ticket` · `2:45 PM`

## Right panel

**Knowledge Sources** → *Retrieved documents (Top 3)*. Each card: title, snippet, source
collection, and a relevance score.

| title | source | relevance |
| --- | --- | --- |
| Database Troubleshooting Guide — *Common issues and solutions for database services...* | HMGICS IT Operations Runbook | 0.98 |
| Database service monitoring and recovery steps... | System Health Dashboard | 0.95 |
| Check database metrics and alerts... | — | 0.91 |

Then `View all sources →`.

**System Status**: `Application → Database · Connected` · `Vector DB · Healthy` · `LLM Service · Ready`

**Quick Actions**: `Reset Password` · `Check Service Status` · `Create IT Ticket`

## Composer

`aungaung` · `Sign Out` · connector selector `All Connectors` · placeholder
`Ask an IT question...` · hint `Ctrl + Enter`

## Palette

| role | value |
| --- | --- |
| canvas | `#12151D` |
| surface | `#222635`, `#181E2B`, `#1D2130` |
| muted text | `#6782A0` |
| **accent** | `#0048F0` |

This is a **navy, blue-accented** palette. Note the tension with the Linear/Vercel retune
(neutral grays, indigo `#5E6AD2`) applied earlier in the same session — see the open
question in the session report.

## Status against the current build

Done:

- **Palette** — canvas `#12151D`, surface `#1D2130`, muted text `#6782A0`, accent
  `#0048F0`, applied to both theme blocks in `frontend/src/styles.css` plus the `slate`
  ramp override (so all ~1,235 raw `slate-*` usages follow). Measured: muted 4.59:1 (AA),
  white-on-accent 6.59:1 (AA), card lift 1.141:1. `#0048F0` is 2.77:1 as *text* on the
  canvas, so accent text uses `#5C8CFF` (5.78:1) while filled buttons keep the mockup blue.
- **RAG pipeline band** — three fixed bands: header (`RAG Pipeline · Tracing live · ⏱ 20.6s`),
  a stage row that is **always visible**, and an `Execution Details · N/M completed`
  expander. `RagPipelineStatus.tsx`.
- **Top bar status chips** — `APP OK · DB Connected · Vector DB Healthy · LLM Ready`, driven
  by real probes from `GET /api/dashboard/health`. `StatusChips.tsx`.
- **Answer typography** — 12px -> 13.5px, full-width prose container instead of a bordered
  88% bubble. Message column and composer share one 900px width.
- **Stop generation** — the stream accepted an `AbortSignal` but nothing created one.

Also done in the same round:

- **Sidebar `New Chat`** — full-width primary button at the top, dispatching the same
  `ith:new-chat` event the Chat nav item fires (one definition of "start over", not two).
- **Sidebar relative ages** — `relativeAge()` in `features/chat/model.ts` puts a terse age
  (`2m`, `1d`, `2d`, `3w`) at the end of every history row. The buckets and the `History (N)`
  header already existed in `PageSidebar.tsx`; only the per-row age was missing.
- **Right panel `System Status`** — lists what `GET /api/dashboard/health` actually reported,
  refreshing every 60s. No row is invented to make the panel look complete.
- **Right panel `Quick Actions`** — `Reset Password` / `Check Service Status` prefill the
  composer via an `ith:ask` event (deliberately a prefill, not a send: the user reads the
  exact prompt before it goes out); `Create IT Ticket` / `My Tickets` navigate.
- **Answer footer** — `Was this helpful?` label, then `Copy` / `Regenerate` /
  `Create Jira Ticket`. Copy and Regenerate are duplicated from the header actions on
  purpose: at the end of a long answer that is where the eye already is.

Left undone deliberately:

- The composer's connector scope already reads `All connectors`; the mockup capitalises it
  as `All Connectors`. Not worth a code change.
- The mockup's composer hint is `Ctrl + Enter`. The composer actually sends on `Enter`
  (Shift+Enter for a newline), so the hint states the real binding instead.

## Method note

The mockup was read by OCR (`RapidOCR`, after inverting and 2x upscaling so the dark UI
becomes dark-on-light), not by a vision model — the vision provider was returning an
adapter error. Every string above is a transcription, and the palette was measured from
pixel statistics rather than judged by eye.
