import { useState, useRef } from "react";
import { Upload, Trash2, Image as ImageIcon, Check, AlertCircle } from "lucide-react";
import { apiFetch, authHeaders, BASE } from "@/shared/api/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { brandInitials, refreshBrandingCache } from "@/app/useBranding";

type Branding = { logo: string | null; appName: string | null };

export async function fetchBranding(): Promise<Branding> {
  const r = await apiFetch(`${BASE}/api/branding`);
  if (!r.ok) return { logo: null, appName: null };
  return r.json();
}

/**
 * Settings → Branding: the administrator's own mark and name.
 *
 * The mark and the name are two halves of one thing, so this section has NO save button of
 * its own — the name is a controlled field that the page's single "Save changes" writes
 * along with the rest of the preferences. The logo is a file upload, so it applies when
 * chosen (with a confirmation step) and can be cleared back to the built-in mark.
 */
export function BrandingSettings({
  appName,
  onAppNameChange,
  onChanged,
}: {
  appName: string | null;
  onAppNameChange: (v: string) => void;
  onChanged?: (b: Branding) => void;
}) {
  const [branding, setBranding] = useState<Branding>({ logo: null, appName: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  if (!loaded) {
    setLoaded(true);
    fetchBranding().then((b) => setBranding(b)).catch(() => {});
  }

  /** One place that publishes a change to the rest of the UI (login page, sidebar). */
  function publish(b: Branding) {
    setBranding(b);
    refreshBrandingCache(b);
    onChanged?.(b);
  }

  async function doUpload(file: File) {
    setBusy(true); setErr(null); setSaved(false);
    try {
      if (!["image/png", "image/jpeg"].includes(file.type)) {
        throw new Error("Only PNG or JPG images are allowed");
      }
      if (file.size > 2 * 1024 * 1024) throw new Error("Image exceeds the 2 MB limit");
      const fd = new FormData();
      fd.append("file", file);
      const r = await apiFetch(`${BASE}/api/admin/branding/logo`, {
        method: "PUT", headers: { ...authHeaders() }, body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `Upload failed (HTTP ${r.status})`);
      }
      const b = await fetchBranding();
      publish(b);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function confirmUpload() {
    if (!pendingFile) return;
    const f = pendingFile;
    setPendingFile(null);
    doUpload(f);
  }

  async function reset() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`${BASE}/api/admin/branding/logo`, { method: "DELETE", headers: { ...authHeaders() } });
      if (!r.ok) throw new Error(`Reset failed (HTTP ${r.status})`);
      const b = await fetchBranding();
      publish(b);
    } catch (e: any) {
      setErr(e?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Preview + upload zone */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 pb-5 border-b border-[var(--border)]">
        <div className="grid size-18 shrink-0 place-items-center overflow-hidden rounded-2xl border border-[var(--border)] bg-muted/40 shadow-xs">
          {branding.logo ? (
            <img src={branding.logo} alt="Current logo" className="size-full object-contain p-1.5" />
          ) : (
            <span className="text-sm font-extrabold tracking-tight text-[var(--primary)]">
              {brandInitials(appName)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">
            {branding.logo ? "Custom logo active" : "Built-in mark in use"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Upload a PNG or JPG (square recommended, up to 2 MB) to replace the mark on the
            login page and the sidebar. With no logo the app shows the initials of the brand
            name below.
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--primary)] px-3.5 py-2 text-xs font-medium text-[var(--primary-foreground)] shadow-xs transition hover:opacity-90 disabled:opacity-50">
              {busy ? <ImageIcon className="size-3.5 animate-pulse" /> : <Upload className="size-3.5" />}
              {branding.logo ? "Replace logo" : "Upload logo"}
            </button>
            {branding.logo && (
              <button type="button" disabled={busy} onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/15 disabled:opacity-50">
                <Trash2 className="size-3.5" /> Remove logo
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); } }} />
        </div>
      </div>

      {/* Logo upload confirmation (v0.22 — user asked for explicit confirm) */}
      {pendingFile && (
        <Dialog open onOpenChange={(next) => { if (!next && !busy) setPendingFile(null); }}>
          <DialogContent size="confirm" className="p-5" showCloseButton={false}>
            <DialogTitle className="sr-only">Replace logo</DialogTitle>
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--primary)]">
                <ImageIcon className="size-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">Replace logo?</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  <span className="break-all font-medium text-foreground">{pendingFile.name}</span>{" "}
                  ({(pendingFile.size / 1024).toFixed(0)} KB) will replace the current logo on the login page and sidebar across the whole application.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingFile(null)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted">
                Cancel
              </button>
              <button type="button" onClick={confirmUpload} disabled={busy}
                className="rounded-lg bg-[var(--primary)] px-3.5 py-2 text-xs font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 disabled:opacity-50">
                {busy ? "Uploading…" : "Yes, replace logo"}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* The brand name — one field, saved by the page's single Save */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div className="min-w-0">
          <label htmlFor="brand-name" className="block text-xs font-semibold text-foreground">
            Brand name
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Shown beside the mark on the login page and in the sidebar. Leave it empty to use
            the built-in name. Saved with the rest of your preferences.
          </p>
        </div>
        <input
          id="brand-name"
          value={appName ?? ""}
          onChange={(e) => onAppNameChange(e.target.value)}
          placeholder="Your workspace name"
          maxLength={48}
          className="h-10 w-full sm:w-64 rounded-xl border border-[var(--border)] bg-background px-3 text-xs outline-none transition focus:border-[var(--primary)]"
          aria-label="Brand name"
        />
      </div>

      {err && (
        <p className="flex items-center gap-1.5 text-2xs text-[var(--danger)]">
          <AlertCircle className="size-3.5" /> {err}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-2xs text-[var(--ok)]">
          <Check className="size-3.5" /> Logo updated — visible on the login page immediately
        </p>
      )}
    </div>
  );
}
