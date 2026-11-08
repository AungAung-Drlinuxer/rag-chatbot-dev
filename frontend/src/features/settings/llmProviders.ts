/**
 * LLM provider presets (v0.22.1).
 *
 * The Settings UI used to accept a free-text "provider" string, which is how the
 * database ended up holding `ClinePass` while the backend only recognised a
 * fixed allow-list — every request was routed to the Anthropic SDK and failed
 * over to the local model. Presets keep the provider id, the OpenAI-compatible
 * base URL and a known-good model id in lockstep.
 *
 * Nothing here is persisted in the browser: a choice only takes effect after the
 * admin saves, and the save goes to `/api/settings/integrations/llm` → the
 * `system_settings` table in PostgreSQL. The key itself is write-only.
 */

export type LlmPreset = {
  /** Stored in `llm.provider`, lower-case. Backend routes anything non-anthropic to the OpenAI client. */
  id: string;
  label: string;
  /** OpenAI-compatible base URL, without a trailing slash. */
  base_url: string;
  /** Default model id for this provider (empty = type it yourself). */
  model: string;
  docs: string;
  note: string;
};

export const LLM_PRESETS: LlmPreset[] = [
  {
    id: "clinepass",
    label: "ClinePass",
    base_url: "https://api.cline.bot/api/v1",
    model: "cline-pass/deepseek-v4.1-flash",
    docs: "https://cline.bot/cline-pass",
    note:
      "Curated open-weight models (DeepSeek, GLM, Kimi, Qwen, MiniMax, MiMo). " +
      "Model ids are namespaced `cline-pass/<model>`; the gateway's generic /models " +
      "listing omits them, so Load models reads the ClinePass catalogue instead. " +
      "API key: Cline dashboard → Settings → API Keys.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "",
    docs: "https://openrouter.ai/keys",
    note: "Aggregator for many vendors. Key starts with sk-or-v1-.",
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "",
    docs: "https://platform.openai.com/api-keys",
    note: "Direct OpenAI platform key.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    model: "",
    docs: "https://platform.deepseek.com/api_keys",
    note: "Direct DeepSeek platform key.",
  },
  {
    id: "ollama",
    label: "Ollama (in-cluster)",
    base_url: "http://ollama.rag-chatbot.svc.cluster.local:11434/v1",
    model: "",
    docs: "https://ollama.com/library",
    note: "Local OpenAI-compatible endpoint — no API key required.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    base_url: "",
    model: "",
    docs: "https://platform.openai.com/docs/api-reference/chat",
    note: "Any gateway that speaks POST /chat/completions.",
  },
];

const PROVIDER_ALIASES: Record<string, string> = {
  "cline-pass": "clinepass",
  cline: "clinepass",
};

/** Preset for a stored provider id, or the "custom" fallback. */
export function presetFor(provider?: string | null): LlmPreset {
  const raw = String(provider || "").trim().toLowerCase();
  const id = PROVIDER_ALIASES[raw] ?? raw;
  return LLM_PRESETS.find((p) => p.id === id) ?? LLM_PRESETS[LLM_PRESETS.length - 1];
}

/** Human label for a stored provider id ("clinepass" → "ClinePass"). */
export function providerLabel(provider?: string | null): string {
  const raw = String(provider || "").trim();
  if (!raw) return "Not configured";
  return presetFor(raw).label === "Custom (OpenAI-compatible)" ? raw : presetFor(raw).label;
}
