import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ImageUp, Loader2, Shuffle, Sparkles, Trash2, UserRound } from "lucide-react";

import { getMe } from "@/features/auth/api";
import { Avatar, useAvatarEditor } from "@/features/users/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "./SettingsKit";

/**
 * The signed-in user's own photo, plus a "Choose an avatar" sheet of drawn presets.
 *
 * Every preset is rendered to a 256×256 canvas and uploaded through the same endpoint as a
 * chosen file, so the rest of the app sees an ordinary photo: roster, sidebar and chat all
 * read /api/users/{username}/avatar. There is no second storage path to keep in sync.
 *
 * The marks are abstract rather than initials — at 32 px in a chat row an initial reads as
 * text, a shape reads as a picture.
 */

type Palette = { bg: string; ink: string; accent: string };

const PALETTES: Palette[] = [
  { bg: "#C7D2FE", ink: "#312E81", accent: "#6366F1" },
  { bg: "#BFDBFE", ink: "#1E3A8A", accent: "#3B82F6" },
  { bg: "#BAE6FD", ink: "#0C4A6E", accent: "#0EA5E9" },
  { bg: "#99F6E4", ink: "#134E4A", accent: "#14B8A6" },
  { bg: "#BBF7D0", ink: "#14532D", accent: "#22C55E" },
  { bg: "#FDE68A", ink: "#78350F", accent: "#F59E0B" },
  { bg: "#FECACA", ink: "#7F1D1D", accent: "#EF4444" },
  { bg: "#FBCFE8", ink: "#831843", accent: "#EC4899" },
  { bg: "#DDD6FE", ink: "#4C1D95", accent: "#8B5CF6" },
  { bg: "#E2E8F0", ink: "#0F172A", accent: "#64748B" },
  { bg: "#4C1D95", ink: "#EDE9FE", accent: "#A78BFA" },
  { bg: "#0F172A", ink: "#E2E8F0", accent: "#38BDF8" },
];

type Glyph = "asterisk" | "grid" | "petals" | "rings" | "stripes" | "dots"
  | "triangle" | "wave" | "cross" | "arcs" | "diamond" | "bars";

const GLYPHS: Glyph[] = [
  "asterisk", "grid", "petals", "rings", "stripes", "dots",
  "triangle", "wave", "cross", "arcs", "diamond", "bars",
];

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, p: Palette, size: number) {
  const c = size / 2;
  ctx.save();
  ctx.strokeStyle = p.ink;
  ctx.fillStyle = p.ink;
  ctx.lineWidth = Math.max(2, size * 0.045);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (glyph) {
    case "asterisk": {
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * size * 0.055, c + Math.sin(a) * size * 0.055);
        ctx.lineTo(c + Math.cos(a) * size * 0.27, c + Math.sin(a) * size * 0.27);
        ctx.stroke();
      }
      break;
    }
    case "grid": {
      const s = size * 0.115;
      const gap = size * 0.035;
      const start = c - s - gap / 2;
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          ctx.beginPath();
          ctx.roundRect(start + col * (s + gap), start + r * (s + gap), s, s, s * 0.22);
          ctx.fill();
        }
      }
      break;
    }
    case "petals": {
      for (let i = 0; i < 4; i++) {
        const a = (Math.PI / 2) * i + Math.PI / 4;
        ctx.beginPath();
        ctx.ellipse(c + Math.cos(a) * size * 0.13, c + Math.sin(a) * size * 0.13,
          size * 0.135, size * 0.075, a, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "rings": {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath();
        ctx.arc(c, c, size * 0.075 * i + size * 0.04, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "stripes": {
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
      ctx.clip();
      for (let i = -6; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(i * size * 0.075, 0);
        ctx.lineTo(i * size * 0.075 + size * 0.3, size);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case "dots": {
      for (let r = 0; r < 3; r++) {
        for (let col = 0; col < 3; col++) {
          if (r === 1 && col === 1) continue;
          ctx.beginPath();
          ctx.arc(c + (col - 1) * size * 0.15, c + (r - 1) * size * 0.15, size * 0.038, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case "triangle": {
      ctx.beginPath();
      ctx.moveTo(c, c - size * 0.25);
      ctx.lineTo(c + size * 0.24, c + size * 0.19);
      ctx.lineTo(c - size * 0.24, c + size * 0.19);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "wave": {
      ctx.beginPath();
      for (let x = -size * 0.3; x <= size * 0.3; x += 2) {
        const y = Math.sin((x / size) * Math.PI * 3) * size * 0.1;
        if (x === -size * 0.3) ctx.moveTo(c + x, c + y);
        else ctx.lineTo(c + x, c + y);
      }
      ctx.stroke();
      break;
    }
    case "cross": {
      const w = size * 0.1;
      const l = size * 0.28;
      ctx.beginPath();
      ctx.roundRect(c - w / 2, c - l, w, l * 2, w * 0.4);
      ctx.roundRect(c - l, c - w / 2, l * 2, w, w * 0.4);
      ctx.fill();
      break;
    }
    case "arcs": {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(c, c, size * (0.11 + i * 0.08), Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      break;
    }
    case "diamond": {
      ctx.beginPath();
      ctx.moveTo(c, c - size * 0.26);
      ctx.lineTo(c + size * 0.26, c);
      ctx.lineTo(c, c + size * 0.26);
      ctx.lineTo(c - size * 0.26, c);
      ctx.closePath();
      ctx.fillStyle = p.accent;
      ctx.fill();
      break;
    }
    case "bars": {
      const w = size * 0.075;
      [0.16, 0.27, 0.2].forEach((h, i) => {
        const height = size * h;
        ctx.beginPath();
        ctx.roundRect(c + (i - 1) * size * 0.14 - w / 2, c + size * 0.2 - height, w, height, w / 2);
        ctx.fill();
      });
      break;
    }
  }
  ctx.restore();
}

function drawAvatar(glyph: Glyph, palette: Palette, size = 256): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, size, size);
    // One soft highlight, so twelve flat swatches do not look like a colour chart.
    ctx.beginPath();
    ctx.arc(size * 0.82, size * 0.16, size * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill();
    drawGlyph(ctx, glyph, palette, size);
  }
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

type Preset = { glyph: Glyph; palette: Palette };

function defaultPresets(): Preset[] {
  return GLYPHS.map((glyph, i) => ({ glyph, palette: PALETTES[i % PALETTES.length] }));
}

function shuffledPresets(): Preset[] {
  const palettes = [...PALETTES].sort(() => Math.random() - 0.5);
  return GLYPHS.map((glyph, i) => ({ glyph, palette: palettes[i % palettes.length] }));
}

export default function ProfilePhotoSettings() {
  const [me, setMe] = useState<{ username: string; displayRole?: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [presets, setPresets] = useState<Preset[]>(defaultPresets);
  const [selected, setSelected] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => {
        if (alive) setMe({ username: m.username, displayRole: m.displayRole });
      })
      .catch(() => {
        if (alive) setLoadError("Could not read your account.");
      });
    return () => {
      alive = false;
    };
  }, []);

  const username = me?.username ?? "";
  const { upload, remove, busy, version } = useAvatarEditor(username || "__none__", 0);

  // Thumbnails are drawn once per shuffle, not per render — twelve canvases per keystroke
  // would be wasteful, and the data URLs are cheap to hold.
  useEffect(() => {
    setThumbs(presets.map((p) => drawAvatar(p.glyph, p.palette, 128).toDataURL("image/png")));
  }, [presets]);

  const pick = useCallback(
    async (file?: File) => {
      if (!file) return;
      setError(null);
      const res = await upload(file);
      if (!res.ok) setError(res.error);
    },
    [upload],
  );

  const savePreset = useCallback(async () => {
    setError(null);
    const preset = presets[selected];
    const blob = await toBlob(drawAvatar(preset.glyph, preset.palette, 256));
    if (!blob) {
      setError("Could not draw that avatar in this browser.");
      return;
    }
    const file = new File([blob], `avatar-${preset.glyph}-${selected + 1}.png`, { type: "image/png" });
    const res = await upload(file);
    if (res.ok) setPickerOpen(false);
    else setError(res.error);
  }, [presets, selected, upload]);

  return (
    <Panel
      icon={<UserRound className="size-4.5" />}
      title="Profile photo"
      description="Shown beside your name in the roster, tickets and conversations."
      actions={version > 0 ? <Pill tone="ok">Photo set</Pill> : <Pill tone="muted">Initials</Pill>}
    >
      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        {me ? (
          <Avatar
            name={me.username}
            username={me.username}
            version={version}
            size="size-16"
            rounded="rounded-2xl"
            className={busy ? "opacity-60" : ""}
          />
        ) : (
          <span className="size-16 animate-pulse rounded-2xl bg-muted" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">
            {me ? `@${me.username}` : loadError ?? "Loading your account…"}
          </p>
          <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
            Pick one of twelve presets, or upload your own. PNG, JPEG or WebP is cropped
            square and resized to 256×256 in your browser before it is uploaded.
          </p>
          {error && <p className="mt-1 text-2xs text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={!me || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            <Sparkles className="size-3.5" /> Choose an avatar
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!me || busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />}
            {version ? "Change photo" : "Upload photo"}
          </button>
          {version > 0 && (
            <button
              type="button"
              onClick={async () => {
                setError(null);
                const res = await remove();
                if (!res.ok) setError(res.error);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-2xs font-medium text-muted-foreground transition hover:text-[var(--danger)] disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Remove
            </button>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogTitle>Choose an avatar</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">Use one of these instead of a photo.</p>

          <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6" role="radiogroup" aria-label="Preset avatars">
            {thumbs.map((src, i) => {
              const on = selected === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Avatar ${i + 1}`}
                  onClick={() => setSelected(i)}
                  className={[
                    "relative aspect-square rounded-full transition",
                    on
                      ? "ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--card)]"
                      : "ring-1 ring-black/10 hover:ring-[var(--primary)]/50",
                  ].join(" ")}
                >
                  <img src={src} alt="" className="size-full rounded-full" draggable={false} />
                  {on && (
                    <span className="absolute bottom-0 right-0 grid size-4 place-items-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)]">
                      <Check className="size-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => { setPresets(shuffledPresets()); setSelected(0); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-2xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <Shuffle className="size-3.5" /> Shuffle
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void savePreset()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-60"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

/* Local alias so the import list stays short and the panel matches the other settings cards. */
function Pill({ tone, children }: { tone: "ok" | "muted"; children: React.ReactNode }) {
  const styles =
    tone === "ok"
      ? "border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]"
      : "border-[var(--border)] bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium ${styles}`}>
      {children}
    </span>
  );
}
