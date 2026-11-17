/**
 * One identity for the assistant, in every place it appears.
 *
 * The mascot is the product's face: launcher, panel header, welcome screen and the avatar
 * beside an answer all read the same asset at different sizes. A single source also means a
 * future redraw is one file, not five icon swaps.
 *
 * The PNG/WebP has a transparent surround and a baked circular crop, so `rounded-full` plus
 * `object-cover` is enough; the asset itself is square (512 px) and scales cleanly down to
 * 24 px.
 */

const SRC = "/assistant-avatar.webp";

export function AssistantAvatar({
  size = 32,
  className = "",
  ring = false,
}: {
  size?: number;
  className?: string;
  /** A hairline ring, for when the avatar sits on a photo or a gradient. */
  ring?: boolean;
}) {
  return (
    <img
      src={SRC}
      width={size}
      height={size}
      alt="IT assistant"
      draggable={false}
      decoding="async"
      className={`shrink-0 select-none rounded-full object-cover ${ring ? "ring-1 ring-white/25" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
