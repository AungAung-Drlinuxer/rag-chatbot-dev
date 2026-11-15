import { useCallback, useEffect, useRef, useState } from "react";

import { BASE, authHeaders } from "@/shared/api/client";

/**
 * Profile photos.
 *
 * The avatar endpoint sits behind the same Bearer token as the rest of the API, so an
 * `<img src="/api/users/x/avatar">` would 401 — there is no cookie to ride along. Each photo is
 * therefore fetched as a blob and handed to the tag as an object URL. Results are cached per
 * `username:version`, so a roster of 20 people does 20 requests once, not once per render, and a
 * new upload (which bumps the version) is picked up immediately.
 */

type Entry = { url: string | null; promise?: Promise<string | null> };

const cache = new Map<string, Entry>();

function keyOf(username: string, version: number) {
  return `${username}:${version}`;
}

async function load(username: string, version: number): Promise<string | null> {
  const key = keyOf(username, version);
  const hit = cache.get(key);
  if (hit?.url) return hit.url;
  if (hit?.promise) return hit.promise;

  const promise = (async () => {
    try {
      const r = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}/avatar?v=${version}`, {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (!r.ok) return null;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      cache.set(key, { url });
      return url;
    } catch {
      return null;
    }
  })();

  cache.set(key, { url: null, promise });
  return promise;
}

/** Drop every cached image for one user. Without this, a photo fetched at version 0 (before the
 *  editor learned the real version) stayed on screen after Remove, because the key was reused. */
function forgetUser(username: string) {
  for (const [key, entry] of cache) {
    if (key.startsWith(`${username}:`)) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      cache.delete(key);
    }
  }
}

export function useAvatarUrl(username?: string | null, version = 0): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!username) return null;
    return cache.get(keyOf(username, version))?.url ?? null;
  });

  useEffect(() => {
    if (!username) {
      setUrl(null);
      return;
    }
    let alive = true;
    void load(username, version).then((next) => {
      if (alive) setUrl(next);
    });
    return () => {
      alive = false;
    };
  }, [username, version]);

  return url;
}

/** Deterministic colour per person, so two initials are told apart at a glance. */
export function avatarTone(name: string): string {
  const tones = [
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
    "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
    "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200",
    "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-200",
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return tones[hash % tones.length];
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  name,
  username,
  version = 0,
  size = "size-9",
  rounded = "rounded-full",
  className = "",
}: {
  name: string;
  username?: string | null;
  version?: number;
  size?: string;
  rounded?: string;
  className?: string;
}) {
  const src = useAvatarUrl(username, version);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        className={`${size} ${rounded} shrink-0 object-cover ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid ${size} ${rounded} shrink-0 place-items-center text-2xs font-bold ${avatarTone(name)} ${className}`}
    >
      {getInitials(name)}
    </span>
  );
}

/** Crop to a square and re-encode small enough that the server never has to process an image. */
export async function fileToAvatarBlob(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize images.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.86),
  );
  if (!blob) throw new Error("This browser cannot encode WebP.");
  return blob;
}

/** Upload / remove the photo for one user, refreshing this hook's cache on success. */
export function useAvatarEditor(username: string, version: number) {
  const [busy, setBusy] = useState(false);
  const [localVersion, setLocalVersion] = useState(version);
  const mounted = useRef(true);

  useEffect(() => {
    setLocalVersion(version);
  }, [version]);

  /* The caller often knows only "this page has no version yet" (the settings card mounts with
     0). Ask the server once so an existing photo shows as a photo, with Change and Remove,
     instead of pretending the account has none. */
  useEffect(() => {
    if (version > 0) return;
    let alive = true;
    fetch(`${BASE}/api/users/${encodeURIComponent(username)}/avatar/meta`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j?.version) setLocalVersion(Number(j.version));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [username, version]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const blob = await fileToAvatarBlob(file);
        const body = new FormData();
        body.append("file", blob, "avatar.webp");
        const r = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}/avatar`, {
          method: "POST",
          headers: authHeaders(),
          body,
        });
        if (!r.ok) {
          const detail = await r.json().catch(() => ({}));
          throw new Error(detail?.detail || `Upload failed (HTTP ${r.status})`);
        }
        const data = await r.json();
        forgetUser(username);
        if (mounted.current) setLocalVersion(Number(data.version) || localVersion + 1);
        return { ok: true as const };
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Upload failed" };
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [username, localVersion],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/api/users/${encodeURIComponent(username)}/avatar`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      forgetUser(username);
      if (mounted.current) setLocalVersion(0);
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Remove failed" };
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [username]);

  return { upload, remove, busy, version: localVersion };
}
