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

import { clearBoardLayout, getBoardLayout, saveBoardLayout } from "@/features/dashboard/api";
import {
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
  beginEdit: () => void;
  /** Leave the arrange mode without keeping anything moved since it started. */
  cancelEdit: () => void;
  setEditing: (value: boolean) => void;
  /** Apply geometry the surface committed (after a drag or a resize). */
  commit: (next: PanelRects) => void;
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

  /* First paint comes from the stored arrangement, not the default one. Starting at
     `defaults` and correcting in an effect is what made a refresh visibly rearrange the
     board: every observer saw the default grid for a frame (or for as long as the layout
     request took) before their own layout landed. */
  const [rects, setRects] = useState<PanelRects>(() => {
    const local = loadLocal(key);
    return local ? sanitiseRects(local.rects, panels) : defaults;
  });
  const [savedPrint, setSavedPrint] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  /* The arrangement as it was when the mode opened: Cancel puts it back, which is the
     difference between "try a layout" and "commit to a layout". */
  const editStart = useRef<PanelRects | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const alive = useRef(true);

  /* Panels arrive from the data fetch and are a fresh array on every render; reading them
     through a ref keeps this effect keyed to the identity (role) alone, so a data refresh
     can never reset an arrangement that is already on screen. */
  const panelsRef = useRef(panels);
  panelsRef.current = panels;
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  useEffect(() => {
    alive.current = true;
    const list = panelsRef.current;

    const local = loadLocal(key);
    if (local) {
      const clean = sanitiseRects(local.rects, list);
      setRects(clean);
      setSavedPrint(print(clean));
      setSavedAt(local.savedAt);
    } else if (!Object.keys(rectsRef.current).length) {
      /* Nothing stored for this identity AND nothing already drawn: start from the default
         grid. When the identity is still resolving (role "" → "admin") the board keeps what
         it is showing instead of jumping to defaults and back. */
      setRects(defaultsRef.current);
    }

    getBoardLayout()
      .then((res) => {
        if (!alive.current) return;
        if (res.board?.rects && Object.keys(res.board.rects).length) {
          const clean = sanitiseRects(res.board.rects, panelsRef.current);
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
  }, [key]);

  /* A panel added (or removed) since the layout was saved: fit the stored rectangles to the
     new set without touching where anything already sits. */
  useEffect(() => {
    setRects((prev) => {
      const clean = sanitiseRects(prev, panels);
      return print(clean) === print(prev) ? prev : clean;
    });
  }, [panels]);

  /* Only a geometry that differs from what is on screen is accepted, so a stray commit does
     not mark the view dirty and cannot loop back into the surface. */
  const commit = useCallback((next: PanelRects) => {
    if (print(next) === print(rectsRef.current)) return;
    setRects(next);
    setSaved(false);
  }, []);

  const setEditingMode = useCallback((value: boolean) => {
    if (value) editStart.current = Object.fromEntries(
      Object.entries(rects).map(([id, r]) => [id, { ...r }]),
    );
    setEditing(value);
  }, [rects]);

  const beginEdit = useCallback(() => setEditingMode(true), [setEditingMode]);

  const cancelEdit = useCallback(() => {
    if (editStart.current) setRects(editStart.current);
    editStart.current = null;
    setEditing(false);
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
    beginEdit,
    cancelEdit,
    setEditing: setEditingMode,
    commit,
    saveView,
    reset,
    dirty,
    saving,
    saved,
    savedAt,
  };
}
