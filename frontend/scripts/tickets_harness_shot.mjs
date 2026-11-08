// Superseded by the redesign: this entry point now drives the two-pane board.
//
// The old script asserted the previous layout (filter chips, a floating detail sheet,
// ../docs/qa output). Those contracts no longer exist, and keeping a second, weaker copy
// of the same checks only hides regressions. Run the current suite instead.
import "./tickets_redesign_shot.mjs";
