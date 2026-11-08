import { useState, useRef } from "react";
import { Upload, Trash2, Image as ImageIcon, Check, AlertCircle } from "lucide-react";
import { apiFetch, authHeaders, BASE } from "@/shared/api/client";

type Branding = { logo: string | null; appName: string | null };

export async function fetchBranding(): Promise<Branding> {
  const r = await apiFetch(`${BASE}/api/branding`);
  if (!r.ok) return { logo: null, appName: null };
  return r.json();
}

/** Settings → Branding: admin-customizable logo (login page + sidebar). */
export function BrandingSettings({ onChanged }: { onChanged?: (b: Branding) => void }) {
  const [branding, setBranding] = useState<Branding>({ logo: null, appName: null });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [appName, setAppName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [nameDirty, setNameDirty] = useState(false);

  if (!loaded) {
    setLoaded(true);
    fetchBranding().then((b) => { setBranding(b); setAppName(b.appName); }).catch(() => {});
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
      if (appName) fd.append("appName", appName);
      const r = await apiFetch(`${BASE}/api/admin/branding/logo`, {
        method: "PUT", headers: { ...authHeaders() }, body: fd,
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `Upload failed (HTTP ${r.status})`);
      }
      const b = await fetchBranding();
      setBranding(b);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onChanged?.(b);
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function saveName() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch(`${BASE}/api/admin/branding/app-name`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ appName: appName ?? "" }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.detail || `Save failed (HTTP ${r.status})`);
      }
      const b = await fetchBranding();
      setBranding(b);
      setAppName(b.appName);
      setNameDirty(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      onChanged?.(b);
    } catch (e: any) {
      setErr(e?.message || "Save failed");
    } finally {
      setBusy(false);
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
      setBranding(b);
      onChanged?.(b);
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
            <span className="text-xs font-bold tracking-tight text-blue-600">iTH</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-white">
            {branding.logo ? "Custom logo active" : "Default iTH mark in use"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            Upload a PNG or JPG logo (square recommended, up to 2 MB). It replaces the mark on the login page and top sidebar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50">
              {busy ? <ImageIcon className="size-3.5 animate-pulse" /> : <Upload className="size-3.5" />}
              {branding.logo ? "Replace logo" : "Upload logo"}
            </button>
            {branding.logo && (
              <button type="button" disabled={busy} onClick={reset}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                <Trash2 className="size-3.5" /> Reset to default
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPendingFile(f); } }} />
        </div>
      </div>

      {/* Logo upload confirmation (v0.22 — user asked for explicit confirm) */}
      {pendingFile && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Confirm logo upload">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                <ImageIcon className="size-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Replace logo?</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  <span className="break-all font-medium text-slate-700 dark:text-slate-200">{pendingFile.name}</span>{" "}
                  ({(pendingFile.size / 1024).toFixed(0)} KB) will replace the current logo on the login page and sidebar across the whole application.
                </p>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingFile(null)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-muted dark:text-slate-300">
                Cancel
              </button>
              <button type="button" onClick={confirmUpload} disabled={busy}
                className="rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50">
                {busy ? "Uploading…" : "Yes, replace logo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional app-name override for the brand row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
        <div className="min-w-0">
          <label className="block text-xs font-semibold text-slate-900 dark:text-white">
            Brand name (optional)
          </label>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Custom application title displayed beside the logo on the login page and header.
          </p>
        </div>
        <div className="flex w-full sm:w-auto items-center gap-2">
          <input
            value={appName ?? ""}
            onChange={(e) => { setAppName(e.target.value); setNameDirty(true); }}
            placeholder="IT Help Chatbot"
            className="h-10 w-full sm:w-64 rounded-xl border border-[var(--border)] bg-background px-3 text-xs outline-none focus:border-blue-500 transition"
           aria-label="Brand name (optional)"/>
          <button
            type="button"
            onClick={saveName}
            disabled={busy || !nameDirty}
            title="Save brand name"
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? <ImageIcon className="size-3.5 animate-pulse" /> : <Check className="size-3.5" />}
            Save name
          </button>
        </div>
      </div>

      {err && (
        <p className="flex items-center gap-1.5 text-2xs text-rose-600">
          <AlertCircle className="size-3.5" /> {err}
        </p>
      )}
      {saved && (
        <p className="flex items-center gap-1.5 text-2xs text-emerald-600">
          <Check className="size-3.5" /> Branding updated — visible on the login page immediately
        </p>
      )}
    </div>
  );
}
