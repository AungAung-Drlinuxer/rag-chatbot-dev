// Superseded by the two-pane Overview redesign.
//
// The old script measured the previous single-column board (six KPI tiles, a full-width
// health strip, ../docs/qa output) — none of that layout exists now, and keeping a second
// weaker copy of the same checks would only hide regressions. The current suite lives in
// scripts/overview_redesign_shot.mjs and also proves the reporting-window picker still
// reaches the wire.
import "./overview_redesign_shot.mjs";
