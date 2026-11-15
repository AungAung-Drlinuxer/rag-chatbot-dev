import { useCallback, useEffect, useRef, useState } from "react";
import { ImageUp, Loader2, Trash2, UserRound } from "lucide-react";

import { getMe } from "@/features/auth/api";
import { Avatar, useAvatarEditor } from "@/features/users/avatar";
import { Panel } from "./SettingsKit";

/**
 * The signed-in user's own photo.
 *
 * Kept out of the Users page on purpose: that screen is admin-only, and everybody should be able
 * to set their own picture. The server allows self or admin, so this card and the one on the
 * roster share the same endpoint and the same editor hook.
 */
export default function ProfilePhotoSettings() {
  const [me, setMe] = useState<{ username: string; displayRole?: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const pick = useCallback(
    async (file?: File) => {
      if (!file) return;
      setError(null);
      const res = await upload(file);
      if (!res.ok) setError(res.error);
    },
    [upload],
  );

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
            PNG, JPEG or WebP. The picture is cropped square and resized to 256×256 in your
            browser before it is uploaded, so a phone photo is fine.
          </p>
          {error && <p className="mt-1 text-2xs text-[var(--danger)]">{error}</p>}
        </div>

        <div className="flex items-center gap-2">
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
