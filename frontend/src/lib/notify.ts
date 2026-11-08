/**
 * Client-side notification helper (v1.6.40).
 *
 * The ticket flow needs the user to be told something happened BEFORE and AFTER a
 * ticket is created, audibly as well as visually:
 *
 *   before  — the escalation was understood and the ticket form is opening
 *   after   — the ticket exists (the requester email is sent server-side; this is
 *             the in-app half of the same event)
 *
 * The chime is synthesised with the Web Audio API rather than shipping an audio
 * asset: no binary in the bundle, nothing to 404, and it cannot be blocked as a
 * separate request. It is only ever triggered from a user gesture (a click or a
 * form submit), which satisfies browser autoplay policies — and it fails silently
 * if audio is unavailable or muted, so it can never break the flow.
 *
 * Accessibility: honours `prefers-reduced-motion` (skips the chime) and never
 * relies on sound alone — every event also produces a visual notice and a chat
 * message.
 */

type Chime = "before" | "after";

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Two-tone cue: rising for "created", neutral for "starting". */
export function playChime(kind: Chime = "after"): void {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ac = audioContext();
    if (!ac) return;

    // "before" = single soft note; "after" = two-note rise (success feel)
    const notes = kind === "after" ? [660, 990] : [520];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const start = ac.currentTime + i * 0.14;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  } catch {
    /* audio is a nicety — never let it break the flow */
  }
}

/** Short haptic tap on devices that support it (mobile). */
export function buzz(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/** Fire the full "something happened" signal: sound + optional haptics. */
export function alertTicket(kind: Chime): void {
  playChime(kind);
  buzz(kind === "after" ? [14, 40, 14] : 12);
}
