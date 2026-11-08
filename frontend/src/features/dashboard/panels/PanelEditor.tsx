/**
 * PanelEditor — add or edit one panel.
 *
 * Deliberately a small form: type, title, width, and only the options that type actually
 * uses. A panel whose options do not apply shows none, instead of a form full of dead fields.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  MAX_SPAN, MIN_SPAN, PANEL_CATALOGUE, catalogueFor, newPanelId, type PanelSpec, type PanelType,
} from "@/features/dashboard/panels/types";
import { MAX_H, MIN_H, defaultHeightFor } from "@/features/dashboard/panels/grid";

type Props = {
  /** null = nothing open. A panel without `id` in the list means "new". */
  initial: PanelSpec | null;
  isNew: boolean;
  onSave: (panel: PanelSpec) => void;
  onCancel: () => void;
};

const LIST_TYPES = new Set(["needs-review", "recent-tickets"]);

export default function PanelEditor({ initial, isNew, onSave, onCancel }: Props) {
  const [type, setType] = useState<PanelType>("attention");
  const [title, setTitle] = useState("");
  const [span, setSpan] = useState(6);
  const [rows, setRows] = useState(4);
  const [limit, setLimit] = useState(5);
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!initial) return;
    setType(initial.type);
    setTitle(initial.title);
    setSpan(initial.span);
    setRows(initial.h ?? defaultHeightFor(initial.type));
    setLimit(initial.options.limit ?? 5);
    setBody(initial.options.body ?? "");
  }, [initial]);

  if (!initial) return null;

  const entry = catalogueFor(type);
  const usesLimit = LIST_TYPES.has(type);
  const usesBody = type === "note";

  function submit() {
    const options: PanelSpec["options"] = {};
    if (usesLimit) options.limit = limit;
    if (usesBody) options.body = body.slice(0, 2000);
    onSave({
      id: initial!.id || newPanelId(),
      type,
      title: title.trim().slice(0, 120),
      span,
      h: rows,
      options,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={isNew ? "Add panel" : "Edit panel"}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--popover)] p-5 shadow-xl">
        <h2 className="text-sm font-semibold">{isNew ? "Add panel" : "Edit panel"}</h2>
        <p className="mt-0.5 text-2xs text-muted-foreground">
          Panels read the same live endpoints; nothing here changes what the figures mean.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Type</span>
            <select
              value={type}
              onChange={(e) => {
                const next = e.target.value as PanelType;
                setType(next);
                setSpan(catalogueFor(next)?.defaultSpan ?? 6);
                setRows(defaultHeightFor(next));
              }}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-xs"
            >
              {PANEL_CATALOGUE.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {entry.label}{entry.repeatable ? "" : " (one per dashboard)"}
                </option>
              ))}
            </select>
            {entry && <p className="mt-1 text-2xs text-muted-foreground">{entry.description}</p>}
          </label>

          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Title (optional)</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={entry?.label ?? "Panel title"}
              maxLength={120}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-xs"
            />
          </label>

          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Width</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={MIN_SPAN}
                max={MAX_SPAN}
                step={1}
                value={span}
                onChange={(e) => setSpan(Number(e.target.value))}
                className="flex-1"
                aria-label="Panel width in twelfths"
              />
              <span className="w-14 text-right text-2xs tabular-nums text-muted-foreground">{span}/12</span>
            </div>
          </label>

          <label className="block">
            <span className="text-2xs font-medium text-muted-foreground">Height</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={MIN_H}
                max={MAX_H}
                step={1}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="flex-1"
                aria-label="Panel height in rows"
              />
              <span className="w-14 text-right text-2xs tabular-nums text-muted-foreground">{rows} rows</span>
            </div>
          </label>

          {usesLimit && (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">Rows to show</span>
              <input
                type="number"
                min={1}
                max={20}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
                className="mt-1 w-24 rounded-lg border border-[var(--border)] bg-card px-2.5 py-1.5 text-xs"
              />
            </label>
          )}

          {usesBody && (
            <label className="block">
              <span className="text-2xs font-medium text-muted-foreground">Note</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Runbook link, rotation reminder, anything the team should see."
                className="mt-1 w-full rounded-lg border border-[var(--border)] bg-card px-2.5 py-2 text-xs leading-relaxed"
              />
            </label>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={submit}>{isNew ? "Add panel" : "Save panel"}</Button>
        </div>
      </div>
    </div>
  );
}
