/**
 * AI service — the assistant's model provider and answer behaviour, in one place.
 *
 * This section owns the whole "llm" integration: which provider answers, the base URL, the
 * write-only API key, and the model (auto-detected from the provider's catalogue). It also
 * owns the two retrieval knobs that live in the backend runtime, because they are the same
 * decision — "how does the assistant answer" — and splitting them across two screens with
 * two different save buttons is what made the old layout confusing.
 *
 * One section, one Save. Nothing here is stored on the device.
 *
 * v1.7.1 — rebuilt on the shared SettingsKit: a status hero, then Provider / Model /
 * Retrieval panels, then one action bar. Logic is unchanged; only the presentation and
 * a broken `aria-label` on the manual model input were touched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Gauge, Info, KeyRound, Layers, Loader2, Lock,
  Pencil, RefreshCw, Save, Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, XCircle,
} from "lucide-react";

import {
  deleteIntegrationSettings, getIntegrationSettings, getLlmModels, getRuntime,
  putIntegrationSettings, putRuntime, testIntegration,
} from "@/features/settings/api";
import { useConfirm } from "@/components/ui/confirm";
import { LLM_PRESETS, presetFor, providerLabel } from "../llmProviders";
import { IntegrationLogo } from "./IntegrationLogo";
import {
  BTN_DANGER, BTN_GHOST, BTN_PRIMARY, Field, FieldGrid, INPUT, INPUT_MONO, Panel, Pill, RailCard, Row,
  SectionProblem,
  SectionSkeleton,
} from "./SettingsKit";

type Msg = { ok: boolean; text: string } | null;

export function AiServiceSettings({ isAdmin }: { isAdmin: boolean }) {
  // ---- stored provider config ------------------------------------------------------
  const [provider, setProvider] = useState<string>("clinepass");
  const [storedModel, setStoredModel] = useState<string>("");
  const [fieldsSet, setFieldsSet] = useState<string[]>([]);
  const [secretFields, setSecretFields] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // ---- editable form. A value here is an ADD/REPLACE, never a read of what is stored. --
  const [form, setForm] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // ---- model catalogue -------------------------------------------------------------
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [modelsSource, setModelsSource] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const autoDetectedFor = useRef<string | null>(null);

  // ---- retrieval knobs -------------------------------------------------------------
  const [topK, setTopK] = useState("5");
  const [threshold, setThreshold] = useState("0.75");

  // ---- status ----------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  /* A failed fetch used to be swallowed, leaving a form with the default provider and empty
     fields that looked like an unconfigured install rather than a broken request. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const { confirm, dialog } = useConfirm();

  const tokenSet = secretFields.includes("api_key");
  const preset = presetFor(form.provider || provider);
  const isConfigured = (k: string) => fieldsSet.includes(k);
  const isSecret = (k: string) => secretFields.includes(k);
  const editable = (k: string) => !isConfigured(k) || !!replacing[k];

  // ---- load ------------------------------------------------------------------------
  const load = async () => {
    try {
      const d: any = await getIntegrationSettings("llm");
      const s = d?.settings ?? {};
      setProvider(s.provider ?? "clinepass");
      setStoredModel(s.model ?? "");
      setFieldsSet(d?.fields_set ?? []);
      setSecretFields(d?.secret_fields ?? []);
      setUpdatedAt(d?.updated_at ?? null);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message || "Could not load the AI service configuration");
    }
  };

  const loadRuntime = async () => {
    try {
      const d = await getRuntime();
      const o = d?.overrides ?? {};
      if (o.retrieval_top_k != null) setTopK(String(o.retrieval_top_k));
      if (o.confidence_gate_threshold != null) setThreshold(String(o.confidence_gate_threshold));
    } catch { /* non-admin */ }
  };

  /** Read the provider's real catalogue. Uses the SAVED key, so it cannot run from a key
   *  that has only been typed — hence detection on mount and after a save. */
  const loadModels = async () => {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const res = await getLlmModels();
      const list = res.models || [];
      setModels(list);
      setModelsSource((res as { source?: string }).source ?? null);
      if (!list.length) setModelsError("Provider returned an empty model list.");
    } catch (err: any) {
      setModels([]);
      setModelsSource(null);
      setModelsError(err?.message || "Could not reach the provider");
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    (async () => {
      await Promise.all([load(), loadRuntime()]);
      setLoading(false);
    })();
  }, [isAdmin]);

  // Auto-detect once a key is stored, and once per provider/model change — never per render.
  useEffect(() => {
    if (!isAdmin || !tokenSet) return;
    const signature = `${provider}|${storedModel}`;
    if (autoDetectedFor.current === signature) return;
    autoDetectedFor.current = signature;
    void loadModels();
  }, [isAdmin, tokenSet, provider, storedModel]);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q),
    );
  }, [models, modelQuery]);

  // ---- actions ---------------------------------------------------------------------
  /** Changing provider also moves the base URL and model, because a ClinePass provider with
   *  an OpenRouter-style model id authenticates fine and then 404s on every request. */
  function applyProvider(id: string) {
    const p = presetFor(id);
    const next: Record<string, string> = { ...form, provider: id };
    if (p.base_url) next.base_url = p.base_url;
    if (p.model) next.model = p.model;
    setForm(next);
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) if (v && v.trim()) payload[k] = v.trim();
      const changed = Object.keys(payload).length;

      if (changed) await putIntegrationSettings("llm", payload);
      await putRuntime({
        retrieval_top_k: Number(topK) || 5,
        confidence_gate_threshold: Number(threshold) || 0.75,
      });

      await load();
      setForm({});
      setReplacing({});
      setRevealed({});
      setMsg({
        ok: true,
        text: changed
          ? `Saved ${changed} field(s) and the retrieval settings.`
          : "Retrieval settings saved — stored credentials are unchanged.",
      });
      // A newly stored key makes the catalogue reachable; detect it now.
      if (changed) {
        autoDetectedFor.current = null;
        void loadModels();
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const r = await testIntegration("llm");
      setMsg(
        r.ok
          ? { ok: true, text: `Connection OK${r.status ? ` (HTTP ${r.status})` : ""}.` }
          : { ok: false, text: r.detail || r.error || `Provider refused the request${r.status ? ` (HTTP ${r.status})` : ""}.` },
      );
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    const ok = await confirm({
      title: "Revoke the stored provider credentials?",
      description:
        "The key is write-only, so revoking is the only way to remove it. The assistant stops " +
        "answering until a new key is saved.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    setClearing(true);
    setMsg(null);
    try {
      await deleteIntegrationSettings("llm");
      await load();
      setModels([]);
      setMsg({ ok: true, text: "Stored provider credentials removed." });
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || "Could not remove the stored settings" });
    } finally {
      setClearing(false);
    }
  }

  const dirty = Object.values(form).some((v) => v && v.trim().length > 0);
  const selectedModel = form.model || storedModel;

  // ---- read-only view for non-admins -----------------------------------------------
  if (!isAdmin) {
    return (
      <Panel
        icon={<Sparkles className="size-4.5" />}
        title="AI Assistant"
        description="How the assistant answers your questions. Managed by your IT administrators."
      >
        <Row title="AI provider" hint="Configured centrally — you do not need a key.">
          <span className="inline-flex items-center gap-2 text-xs font-medium text-foreground">
            <IntegrationLogo providerKey={preset.id} name={providerLabel(provider)} size="sm" className="size-4" />
            {providerLabel(provider)}
          </span>
        </Row>
        <Row title="Model" hint="The model currently answering.">
          <span className="font-mono text-xs text-muted-foreground">{storedModel || "—"}</span>
        </Row>
      </Panel>
    );
  }

  if (loading) return <SectionSkeleton rows={4} label="Loading the AI service configuration" />;
  if (loadError) {
    return (
      <SectionProblem
        title="Could not load the AI service configuration"
        detail={loadError}
        onRetry={() => {
          setLoadError(null);
          setLoading(true);
          void Promise.all([load(), loadRuntime()]).finally(() => setLoading(false));
        }}
      />
    );
  }

  // The endpoint is shown as a host in the summary — a full cluster URL is not scannable,
  // and the field below already holds the truth.
  const endpointHost = (() => {
    const raw = form.base_url || preset.base_url || "";
    try {
      return new URL(raw).host || raw;
    } catch {
      return raw || "—";
    }
  })();

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      {dialog}
      <div className="space-y-5">
        {/* ---- status -------------------------------------------------------------
            Same anatomy as an Integrations card: provider mark, name, state chips and the
            one link that leaves the app. The numbers it used to bury in a strip are rows. */}
        <Panel
          icon={<IntegrationLogo providerKey={preset.id} name={providerLabel(provider)} size="sm" />}
          title={providerLabel(provider)}
          description="The service that writes answers, and what it currently has to work with."
          actions={
            <>
              {tokenSet
                ? <Pill tone="ok"><CheckCircle2 className="size-3" /> Key stored</Pill>
                : <Pill tone="warn"><AlertCircle className="size-3" /> No API key</Pill>}
              <a
                href={preset.docs}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
              >
                Provider docs <ExternalLink className="size-3" />
              </a>
            </>
          }
        >
          <div className="grid gap-x-6 gap-y-3 px-5 py-3.5 text-[11px] sm:grid-cols-2 xl:grid-cols-4">
            {/* Model ids are long and are the one value here people copy — two lines, never
                an ellipsis in the middle of a name. */}
            <div className="min-w-0 sm:col-span-2 xl:col-span-2">
              <span className="block text-muted-foreground">Model</span>
              <span className="mt-0.5 block break-all font-mono leading-relaxed text-foreground" title={storedModel}>
                {storedModel || "none selected"}
              </span>
            </div>
            <div>
              <span className="block text-muted-foreground">Catalogue</span>
              <span className="mt-0.5 block font-medium text-foreground">
                {models.length > 0
                  ? `${models.length} models detected`
                  : tokenSet ? "detecting…" : "add a key to detect"}
              </span>
            </div>
            <div>
              <span className="block text-muted-foreground">Retrieval</span>
              <span className="mt-0.5 block font-medium text-foreground">top {topK} chunks</span>
            </div>
            <div>
              <span className="block text-muted-foreground">Confidence gate</span>
              <span className="mt-0.5 block font-medium text-foreground">{Math.round((Number(threshold) || 0.75) * 100)}%</span>
            </div>
          </div>
          {updatedAt && (
            <p className="border-t border-[var(--border)] bg-muted/20 px-5 py-2 text-2xs text-muted-foreground">
              Last saved {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </Panel>

        {/* ---- provider ----------------------------------------------------------- */}
        <Panel
          icon={<KeyRound className="size-4" />}
          title="Provider & credentials"
          description="Which service generates the answers, and the key it authenticates with."
        >
          <FieldGrid>
            <Field label="AI provider" hint={preset.note}>
              <div className="relative">
                <select
                  value={form.provider || provider}
                  onChange={(e) => applyProvider(e.target.value)}
                  aria-label="AI provider"
                  className={`${INPUT} appearance-none pr-9 font-medium`}
                >
                  {LLM_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </Field>

            <Field
              label="Base URL"
              badge={isConfigured("base_url") ? <Pill tone="ok"><Lock className="size-3" /> Configured</Pill> : undefined}
            >
              <ValueInput
                field="base_url"
                placeholder="https://api.cline.bot/api/v1"
                form={form}
                setForm={setForm}
                revealed={revealed}
                setRevealed={setRevealed}
                replacing={replacing}
                setReplacing={setReplacing}
                configured={isConfigured("base_url")}
                secretField={isSecret("base_url")}
                editable={editable("base_url")}
                tokenSet={tokenSet}
              />
            </Field>
          </FieldGrid>

          <div className="rounded-xl border border-[var(--border)] bg-muted/25 p-4">
            <Field
              label="API key"
              icon={<KeyRound className="size-3" />}
              badge={tokenSet ? <Pill tone="ok"><Lock className="size-3" /> Saved — not retrievable</Pill> : undefined}
            >
              <ValueInput
                field="api_key"
                placeholder="your provider API key"
                secret
                form={form}
                setForm={setForm}
                revealed={revealed}
                setRevealed={setRevealed}
                replacing={replacing}
                setReplacing={setReplacing}
                configured={isConfigured("api_key")}
                secretField={isSecret("api_key")}
                editable={editable("api_key")}
                tokenSet={tokenSet}
              />
            </Field>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-[var(--ok)]" />
              Write-only: stored server-side and never returned. Leave blank to keep the current key.
            </p>
          </div>
        </Panel>

        {/* ---- model -------------------------------------------------------------- */}
        <Panel
          icon={<Layers className="size-4" />}
          title="Model"
          description="Picked from the provider's live catalogue — or typed by id if it is not listed."
          actions={models.length ? <Pill tone="muted">{models.length} detected</Pill> : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder={models.length ? `Filter ${models.length} models…` : "No models detected yet"}
                disabled={!models.length}
                aria-label="Search models"
                className={`${INPUT} pl-9 disabled:opacity-60`}
              />
            </div>
            <button type="button" onClick={() => void loadModels()} disabled={loadingModels} className={BTN_GHOST}>
              <RefreshCw className={`size-3.5 ${loadingModels ? "animate-spin" : ""}`} />
              {loadingModels ? "Detecting…" : models.length ? "Re-detect" : "Detect models"}
            </button>
          </div>

          {models.length > 0 && (
            <div className="max-h-60 overflow-y-auto rounded-xl border border-[var(--border)] bg-background">
              {filteredModels.length === 0 ? (
                <p className="px-3 py-3 text-[11px] text-muted-foreground">No model matches “{modelQuery}”.</p>
              ) : filteredModels.map((m) => {
                const on = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setForm({ ...form, model: m.id })}
                    aria-pressed={on}
                    className={[
                      "flex w-full items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-left font-mono text-[11px] last:border-b-0 transition",
                      on
                        ? "bg-[var(--accent-soft)] text-[var(--accent-foreground)]"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    ].join(" ")}
                  >
                    <span className="truncate">{m.id}</span>
                    {on && <CheckCircle2 className="ml-auto size-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          <Field
            label="Model id"
            hint={
              storedModel
                ? `Currently saved: ${storedModel} — type to replace it.`
                : "Use this when the catalogue is unavailable or the model is brand new."
            }
          >
            <input
              type="text"
              value={form.model || ""}
              onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
              placeholder={storedModel ? "Type a new model id to replace the saved one" : "or type a model id"}
              spellCheck={false}
              autoComplete="off"
              aria-label="Model id"
              className={INPUT_MONO}
            />
          </Field>

          {modelsError && (
            <p className="flex items-start gap-1 text-[11px] text-[var(--danger)]">
              <AlertCircle className="mt-0.5 size-3 shrink-0" /> {modelsError}
              <button type="button" onClick={() => void loadModels()} className="ml-1 underline hover:no-underline">retry</button>
            </p>
          )}
          {!modelsError && models.length > 0 && (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <CheckCircle2 className="size-3 text-[var(--ok)]" />
              {models.length} model{models.length === 1 ? "" : "s"} auto-detected
              {modelsSource === "clinepass" ? " from the ClinePass catalogue" : " from the provider"}
              {modelQuery && ` — ${filteredModels.length} match “${modelQuery}”`}
            </p>
          )}
        </Panel>

        {/* ---- retrieval ---------------------------------------------------------- */}
        <Panel
          icon={<Gauge className="size-4" />}
          title="Retrieval & answer behaviour"
          description="Shared backend settings — they change the assistant for everyone once saved."
        >
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-semibold">Confidence threshold</p>
              <span className="rounded-lg bg-[var(--accent-soft)] px-2 py-0.5 text-xs font-semibold tabular-nums text-[var(--accent-foreground)]">
                {Math.round((Number(threshold) || 0.75) * 100)}%
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Below this the assistant escalates instead of guessing.</p>
            <input
              type="range"
              min="50"
              max="100"
              step="5"
              value={Math.round((Number(threshold) || 0.75) * 100)}
              onChange={(e) => setThreshold(String(Number(e.target.value) / 100))}
              aria-label="Confidence threshold"
              className="mt-3 h-1.5 w-full accent-[var(--primary)]"
            />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground/70">
              <span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold">Top K results</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Knowledge chunks retrieved per question.</p>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
              aria-label="Top K results"
              className={`${INPUT} w-20 text-center tabular-nums`}
            />
          </div>
        </Panel>
      </div>

      {/* ---- rail: what this save will commit, and the actions --------------------- */}
      <aside className="space-y-5 xl:sticky xl:top-6">
        <RailCard
          icon={<SlidersHorizontal className="size-4" />}
          title="Effective configuration"
          description="What the assistant uses right now."
        >
          <dl className="space-y-2.5">
            {[
              ["Provider", providerLabel(form.provider || provider)],
              ["Model", storedModel || "—"],
              ["Endpoint", endpointHost],
              ["API key", tokenSet ? "Stored" : "Not set"],
              ["Retrieval", `top ${topK || "—"} · ${Math.round((Number(threshold) || 0.75) * 100)}%`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[11px]">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </RailCard>

        <RailCard
          icon={<Save className="size-4" />}
          title="Save"
          description="One save commits the provider fields and the retrieval knobs together."
        >
          <button type="button" onClick={save} disabled={saving} className={`${BTN_PRIMARY} w-full justify-center`}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Save AI settings
          </button>
          <button type="button" onClick={test} disabled={testing} className={`${BTN_GHOST} mt-2 w-full justify-center`}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Test connection
          </button>

          {dirty && !msg && (
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--warn)]">
              <Info className="size-3" /> Unsaved changes
            </p>
          )}
          {msg && (
            <p className={`mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed ${msg.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
              {msg.ok ? <CheckCircle2 className="mt-0.5 size-3 shrink-0" /> : <XCircle className="mt-0.5 size-3 shrink-0" />}
              {msg.text}
            </p>
          )}
          {updatedAt && !msg && (
            <p className="mt-3 text-[11px] text-muted-foreground">Last saved {new Date(updatedAt).toLocaleString()}</p>
          )}

          {(tokenSet || fieldsSet.length > 0) && (
            <button
              type="button"
              onClick={clear}
              disabled={clearing}
              className={`${BTN_DANGER} mt-4 w-full justify-center`}
              title="Revoke the stored credentials — the only way to remove a write-only value"
            >
              {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Remove stored credentials
            </button>
          )}
        </RailCard>
      </aside>
    </div>
  );

}


/* ---------------------------------------------------------------------------------------------
 * These two used to be declared *inside* the page component. A component declared in a render
 * body gets a new function identity on every render, so React saw a different element type each
 * keystroke and unmounted the subtree: the first character was accepted, focus was thrown away,
 * and every character after it went nowhere. Hoisted here so their identity is stable.
 * ------------------------------------------------------------------------------------------- */

type ValueInputProps = {
  field: string;
  placeholder: string;
  secret?: boolean;
  form: Record<string, string>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  revealed: Record<string, boolean>;
  setRevealed: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  replacing: Record<string, boolean>;
  setReplacing: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  configured: boolean;
  secretField: boolean;
  editable: boolean;
  tokenSet: boolean;
};

/** A stored value is never rendered: show a mask and require Replace. */
function ValueInput({
  field,
  placeholder,
  secret,
  form,
  setForm,
  revealed,
  setRevealed,
  replacing,
  setReplacing,
  configured,
  secretField,
  editable,
  tokenSet,
}: ValueInputProps) {
  const isSec = secret || secretField;
  const show = !!revealed[field];

  if (configured && !editable) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-muted/40 px-3">
          <Lock className="size-3 shrink-0 text-muted-foreground" />
          <span className="select-none font-mono text-xs tracking-widest text-muted-foreground">••••••••</span>
          <span className="ml-auto text-2xs text-muted-foreground">write-only</span>
        </div>
        <button
          type="button"
          onClick={() => setReplacing({ ...replacing, [field]: true })}
          className={BTN_GHOST}
          title="Enter a new value"
        >
          <Pencil className="size-3.5" /> Replace
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <input
          type={isSec && !show ? "password" : "text"}
          value={form[field] || ""}
          onChange={(e) => setForm((prev) => ({ ...prev, [field]: e.target.value }))}
          placeholder={isSec && tokenSet ? "leave blank to keep current" : placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          aria-label={field}
          className={`${INPUT_MONO} pr-10 placeholder:font-sans`}
        />
        {isSec && (
          <button
            type="button"
            aria-label={show ? `Hide ${field}` : `Reveal ${field}`}
            onClick={() => setRevealed({ ...revealed, [field]: !show })}
            className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {configured && (
        <button
          type="button"
          onClick={() => {
            setReplacing({ ...replacing, [field]: false });
            setForm((prev) => {
              const n = { ...prev };
              delete n[field];
              return n;
            });
          }}
          className="mt-1 text-2xs text-muted-foreground underline hover:text-foreground"
        >
          Keep the stored value
        </button>
      )}
    </div>
  );
}

/* Eye icons kept local so the import list above stays focused on the section's own verbs. */
function EyeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
}
function EyeOffIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5"><path d="M3 3l18 18" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5.5A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.2 6.7A17.6 17.6 0 0 0 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.8-.8" /></svg>;
}
