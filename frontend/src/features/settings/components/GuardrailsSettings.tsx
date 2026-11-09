/**
 * Settings → Guardrails — the administrator's control surface for the profanity list.
 *
 * The screening itself is backend (`app/security/guardrails.py`); this panel decides what
 * it screens and what it does when it finds a word:
 *   mask  — replace the word (f***) and answer the question
 *   block — refuse the whole message, as the app did before masking existed
 * and whether the model's own answer is filtered on the way out.
 *
 * The word list lives in `system_settings['guardrails']`, so changing it needs no deploy.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, Save, ShieldAlert } from "lucide-react";

import { getGuardrails, putGuardrails, type GuardrailsConfig } from "@/features/settings/api";
import { BTN_GHOST, BTN_PRIMARY, Field, Panel, Pill, Segmented } from "@/features/settings/components/SettingsKit";

const DEFAULTS: GuardrailsConfig = {
  enabled: true,
  mode: "mask",
  output_filter: true,
  use_default_list: true,
  custom_words: [],
  mask_char: "*",
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-6 w-11 shrink-0 rounded-full border transition",
        checked
          ? "border-[var(--primary)] bg-[var(--primary)]"
          : "border-[var(--border)] bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 size-4.5 rounded-full bg-white shadow-sm transition-all",
          checked ? "left-[1.35rem]" : "left-0.5",
        ].join(" ")}
      />
    </button>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-t border-[var(--border)] px-5 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

const toText = (words: string[]) => words.join("\n");
const toWords = (text: string) =>
  Array.from(
    new Set(
      text
        .split(/[\n,]/)
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  );

export default function GuardrailsSettings() {
  const [saved, setSaved] = useState<GuardrailsConfig | null>(null);
  const [draft, setDraft] = useState<GuardrailsConfig>(DEFAULTS);
  const [wordsText, setWordsText] = useState("");
  const [defaultsCount, setDefaultsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await getGuardrails();
      const cfg: GuardrailsConfig = { ...DEFAULTS, ...(res.config ?? {}) };
      setSaved(cfg);
      setDraft(cfg);
      setWordsText(toText(cfg.custom_words ?? []));
      setDefaultsCount(res.default_list_size ?? 0);
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Could not load the guardrail policy.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    if (!saved) return false;
    return (
      saved.mode !== draft.mode ||
      saved.enabled !== draft.enabled ||
      saved.output_filter !== draft.output_filter ||
      saved.use_default_list !== draft.use_default_list ||
      toText(saved.custom_words).trim() !== wordsText.trim()
    );
  }, [saved, draft, wordsText]);

  const save = async () => {
    setSaving(true);
    setError("");
    setNotice("");
    const payload: GuardrailsConfig = { ...draft, custom_words: toWords(wordsText) };
    try {
      const res = await putGuardrails(payload);
      const cfg: GuardrailsConfig = { ...DEFAULTS, ...(res.config ?? payload) };
      setSaved(cfg);
      setDraft(cfg);
      setWordsText(toText(cfg.custom_words ?? []));
      setNotice("Saved. The next message uses the new policy.");
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Could not save the guardrail policy.");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    const base = saved ?? DEFAULTS;
    setDraft(base);
    setWordsText(toText(base.custom_words ?? []));
    setError("");
    setNotice("");
  };

  const customWords = toWords(wordsText);
  const effective = (draft.use_default_list ? defaultsCount : 0) + customWords.length;

  if (loading) {
    return (
      <Panel icon={<ShieldAlert className="size-4.5" />} title="Content guardrails" description="Loading the current policy…">
        <div className="flex items-center gap-2 px-5 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading system_settings…
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel
        icon={<ShieldAlert className="size-4.5" />}
        title="Content guardrails"
        description="What the assistant screens in a question, and what it does with the answer. Prompt injection, PII and oversize messages stay blocked whatever is chosen here."
        actions={
          <Pill tone={draft.enabled ? "ok" : "muted"}>
            {draft.enabled ? `${effective} terms active` : "screening off"}
          </Pill>
        }
      >
        <SettingRow
          title="Screen messages"
          hint="Master switch. Off means no profanity screening on input or output — injection and PII checks still run."
        >
          <Switch checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} label="Screen messages" />
        </SettingRow>

        <SettingRow
          title="When a word is found"
          hint="Mask keeps the conversation going with the word starred out. Block refuses the message instead."
        >
          <Segmented
            label="Profanity handling"
            value={draft.mode}
            onChange={(v) => setDraft({ ...draft, mode: v })}
            options={[
              { value: "mask", label: "Mask & answer" },
              { value: "block", label: "Block message" },
            ]}
          />
        </SettingRow>

        <SettingRow
          title="Filter the answer"
          hint="Also mask the same words in what the model writes back, including the stored transcript."
        >
          <Switch
            checked={draft.output_filter}
            onChange={(v) => setDraft({ ...draft, output_filter: v })}
            label="Filter the answer"
          />
        </SettingRow>

        <SettingRow
          title="Built-in English list"
          hint={`${defaultsCount} common words plus their -ing/-ed/-s forms. Turn it off to screen only your own list.`}
        >
          <Switch
            checked={draft.use_default_list}
            onChange={(v) => setDraft({ ...draft, use_default_list: v })}
            label="Use the built-in word list"
          />
        </SettingRow>

        <div className="border-t border-[var(--border)] px-5 py-4">
          <Field
            label="Your own words"
            hint="One per line, or comma-separated. Any language — Burmese and other scripts match as written. Matched case-insensitively, whole words only."
            badge={<span className="text-2xs text-muted-foreground">{customWords.length} / 500</span>}
          >
            <textarea
              value={wordsText}
              onChange={(e) => setWordsText(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={"office-specific-jargon\nbadword2"}
              className="w-full resize-y rounded-xl border border-[var(--border)] bg-background px-3 py-2 font-mono text-xs leading-6 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]"
              aria-label="Custom profanity words"
            />
          </Field>
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            A masked word keeps its first letter (<span className="font-mono">f***</span>) so the sentence still reads.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-muted/20 px-5 py-3">
          <div className="min-w-0 text-xs">
            {error ? (
              <span className="flex items-center gap-1.5 text-[var(--danger)]">
                <AlertTriangle className="size-3.5" /> {error}
              </span>
            ) : notice ? (
              <span className="text-[var(--ok)]">{notice}</span>
            ) : (
              <span className="text-muted-foreground">
                {dirty ? "Unsaved changes" : "Saved policy is live"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN_GHOST} onClick={reset} disabled={!dirty || saving}>
              <RotateCcw className="size-3.5" /> Discard
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              Save policy
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
