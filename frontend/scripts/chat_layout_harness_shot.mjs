// Superseded by scripts/chat_harness_shot.mjs — kept as a forwarding shim.
//
// This script asserted the previous chat design (a 900px message column, a plain unbordered
// answer, no evidence card, a removable pipeline panel). The redesign deliberately replaced
// all of that: the transcript and the composer share one `max-w-3xl` column, the answer IS a
// bordered card, and the pipeline strip belongs to MessageBubble. Those assertions would now
// fail against a page that is working correctly, so the real coverage lives in
// `chat_harness_shot.mjs` (streaming, meta, stop, composer keys, breakpoints, dark mode).
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["scripts/chat_harness_shot.mjs"], {
  stdio: "inherit",
  cwd: process.cwd(),
});
child.on("exit", (code) => process.exit(code ?? 0));
