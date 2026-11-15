/**
 * "Choose an avatar" — twelve drawn marks, shared by the Settings card and the Users page.
 *
 * Every preset is drawn to a 256×256 canvas and handed to the caller as a File, so both
 * surfaces upload through the same /api/users/{username}/avatar endpoint. There is no second
 * storage path, and a photo set from the roster looks exactly like one set in Settings.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Shuffle } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

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

export function drawAvatar(glyph: Glyph, palette: Palette, size = 256): HTMLCanvasElement {
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

export type Preset = { glyph: Glyph; palette: Palette };

function defaultPresets(): Preset[] {
  return GLYPHS.map((glyph, i) => ({ glyph, palette: PALETTES[i % PALETTES.length] }));
}

function shuffledPresets(): Preset[] {
  const palettes = [...PALETTES].sort(() => Math.random() - 0.5);
  return GLYPHS.map((glyph, i) => ({ glyph, palette: palettes[i % palettes.length] }));
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives a 256 px PNG named after the mark; the caller owns the upload. */
  onSave: (file: File) => Promise<{ ok: true } | { ok: false; error: string }>;
  busy?: boolean;
  /** Shown under the title, e.g. "@alice" when an administrator is editing someone else. */
  forWhom?: string;
};

export default function AvatarPickerDialog({ open, onOpenChange, onSave, busy, forWhom }: Props) {
  const [presets, setPresets] = useState<Preset[]>(defaultPresets);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Thumbnails are drawn once per shuffle, not per render.
  const thumbs = useMemo(
    () => presets.map((p) => drawAvatar(p.glyph, p.palette, 128).toDataURL("image/png")),
    [presets],
  );

  useEffect(() => {
    if (open) {
      setSelected(0);
      setError(null);
    }
  }, [open]);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const preset = presets[selected];
      const blob = await toBlob(drawAvatar(preset.glyph, preset.palette, 256));
      if (!blob) {
        setError("Could not draw that avatar in this browser.");
        return;
      }
      const file = new File([blob], `avatar-${preset.glyph}-${selected + 1}.png`, { type: "image/png" });
      const res = await onSave(file);
      if (res.ok) onOpenChange(false);
      else setError(res.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Choose an avatar</DialogTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          Use one of these instead of a photo{forWhom ? ` for ${forWhom}` : ""}.
        </p>

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

        {error && <p className="mt-2 text-2xs text-[var(--danger)]">{error}</p>}

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
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-2xs font-medium text-foreground transition hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-2xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-60"
            >
              {(busy || saving) && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
