/**
 * Per-panel dashboard geometry, Grafana style.
 *
 * State: one rectangle per panel (`{x, y, w, h}` in a 12-column grid). Three sources, in
 * order of authority: the layout saved for this user on the server, a local copy (so an
 * offline or freshly deployed pod still opens the board the user arranged), and the default.
 *
 * `editing` is a mode, not a permission: drag and resize are only live while it is on, so a
 * dashboard someone reads every day cannot be rearranged by a stray drag.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "react-grid-layout";

import { clearBoardLayout, getBoardLayout, saveBoardLayout } from "@/features/dashboard/api";
import {
  compactRects,
  defaultRects,
  sanitiseRects,
  type PanelLike,
  type PanelRects,
} from "@/features/dashboard/lib/gridLayout";

const STORAGE_PREFIX = "ith:board-grid:v2:";

type Snapshot = { rects: PanelRects; savedAt: string | null };

function storageKey(role: string) {
  return STORAGE_PREFIX + role;
}

function loadLocal(role: string): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey(role));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed?.rects) return null;
    return { rects: parsed.rects, savedAt: parsed.savedAt ?? null };
  } catch {
    return null;
  }
}

function saveLocal(role: string, snapshot: Snapshot) {
  try {
    window.localStorage.setItem(storageKey(role), JSON.stringify(snapshot));
  } catch {
    /* quota or private mode: the server copy is the durable one */
  }
}

function print(rects: PanelRects): string {
  return Object.keys(rects)
    .sort()
    .map((id) => {
      const r = rects[id];
      return `${id}:${r.x},${r.y},${r.w},${r.h}`;
    })
    .join("|");
}

export type GridLayoutApi = {
  rects: PanelRects;
  editing: boolean;
  setEditing: (value: boolean) => void;
  onLayoutChange: (layout: Layout[]) => void;
  saveView: () => Promise<void>;
  reset: () => Promise<void>;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  savedAt: string | null;
};

export function useGridLayout(
  panels: readonly PanelLike[],
  role: string | undefined,
): GridLayoutApi {
  const key = String(role ?? "user");
  const defaults = useMemo(() => defaultRects(panels), [panels]);

  const [rects, setRects] = useState<PanelRects>(defaults);
  const [savedPrint, setSavedPrint] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setRects(defaults);

    const local = loadLocal(key);
    if (local) {
      setRects(sanitiseRects(local.rects, panels));
      setSavedPrint(print(sanitiseRects(local.rects, panels)));
      setSavedAt(local.savedAt);
    }

    getBoardLayout()
      .then((res) => {
        if (!alive.current) return;
        if (res.board?.rects && Object.keys(res.board.rects).length) {
          const clean = sanitiseRects(res.board.rects, panels);
          setRects(clean);
          setSavedPrint(print(clean));
          setSavedAt(res.updated_at);
        } else if (!local) {
          setSavedPrint(null);
        }
      })
      .catch(() => {
        /* offline: the localStorage copy (or the default) is what opens */
      });

    return () => {
      alive.current = false;
    };
  }, [key, panels, defaults]);

  const onLayoutChange = useCallback((layout: Layout[]) => {
    setRects((prev) => {
      const next: PanelRects = { ...prev };
      for (const item of layout) {
        next[item.i] = { x: item.x, y: item.y, w: item.w, h: item.h };
      }
      return compactRects(next);
    });
    setSaved(false);
  }, []);

  const current = useMemo(() => print(rects), [rects]);
  const defaultPrint = useMemo(() => print(defaults), [defaults]);
  const dirty = current !== (savedPrint ?? defaultPrint);

  const saveView = useCallback(async () => {
    setSaving(true);
    try {
      const res = await saveBoardLayout({ rects, spans: {}, bands: [] });
      /* Adopt the server's clamped copy, otherwise "saved" and "what is drawn" can differ
         by a pixel and the view stays dirty forever. */
      const clean = sanitiseRects(res.board?.rects ?? rects, panels);
      setRects(clean);
      setSavedPrint(print(clean));
      setSavedAt(res.updated_at);
      saveLocal(key, { rects: clean, savedAt: res.updated_at });
      setSaved(true);
      window.setTimeout(() => alive.current && setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }, [rects, panels, key]);

  const reset = useCallback(async () => {
    try {
      await clearBoardLayout();
    } catch {
      /* the local reset still happens */
    }
    try {
      window.localStorage.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
    setRects(defaults);
    setSavedPrint(null);
    setSavedAt(null);
    setSaved(true);
    window.setTimeout(() => alive.current && setSaved(false), 2500);
  }, [defaults, key]);

  return {
    rects,
    editing,
    setEditing,
    onLayoutChange,
    saveView,
    reset,
    dirty,
    saving,
    saved,
    savedAt,
  };
}
