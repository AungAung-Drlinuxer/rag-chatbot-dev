import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen, CheckCircle2, ExternalLink, Info, KeyRound, Loader2, Loader as LoaderIcon, Lock,
  Pencil, Save, Search, ShieldCheck, Ticket, Trash2, Users, XCircle,
  Eye, EyeOff, ChevronRight,
} from "lucide-react";
import { IntegrationLogo } from "@/features/settings/components/IntegrationLogo";
import { ConnectionsCard } from "@/features/settings/components/ConnectionsCard";
import {
  deleteIntegrationSettings, getIntegrationSettings, getMySettings, listConnections, putIntegrationSettings, testIntegration, updateMySettings,
} from "@/features/settings/api";

/* ============================================================
   v1.7.0 — Settings → Integrations, rebuilt around OPT-IN.

   Ten providers on one screen is a wall of empty forms: an admin who only uses
   Jira still had to scroll past nine credential panels. So the screen now opens
   on a catalogue of what CAN be connected, every provider is OFF by default,
   and only the providers the operator switches on get a configuration panel.
   The on/off choice is per USER and persisted in that user's preference blob
   (`integration_toggles`), because "which tools do I work with" is a personal
   choice, while the credentials themselves stay deployment-wide (admin only).

   Turning a provider off hides its panel but does NOT delete stored
   credentials — removal stays an explicit, confirmed action inside the panel.
============================================================ */

type ProviderKey = "confluence" | "jira" | "ldap" | "keycloak";

type Field = {
  key: string;
  label: string;
  placeholder: string;
  type?: string;
  isSecret?: boolean;
  /** Rendered as a textarea — for JSON maps and other values too long for one line. */
  multiline?: boolean;
  /** One line under the input telling an admin where the value comes from. */
  hint?: string;
};

type Provider = {
  key: ProviderKey;
  name: string;
  tagline: string;
  desc: string;
  category: Category;
  icon: typeof BookOpen;
  docs: string;
  fields: Field[];
};

type Category = "Knowledge & docs" | "Work tracking" | "Identity & access";

const CATEGORIES: Category[] = ["Knowledge & docs", "Work tracking", "Identity & access"];

/**
 * Field groups. Every integration's fields answer one of three different questions,
 * and a flat column made an endpoint, a secret and a tuning knob look identical.
 * The group is DERIVED from the field key so it stays right when a provider is added.
 */
type FieldGroup = "connection" | "credentials" | "options";

const CREDENTIAL_KEYS = new Set([
  "api_key", "api_token", "access_token", "bind_password", "client_secret", "password", "token", "secret",
]);
const CONNECTION_KEYS = new Set(["base_url", "host", "port", "issuer", "redirect_uri", "url", "realm"]);

function groupOf(fieldKey: string): FieldGroup {
  const k = fieldKey.toLowerCase();
  if (CREDENTIAL_KEYS.has(k)) return "credentials";
  if (CONNECTION_KEYS.has(k)) return "connection";
  return "options";
}

const GROUP_ORDER: FieldGroup[] = ["connection", "credentials", "options"];
const GROUP_META: Record<FieldGroup, { label: string; hint: string }> = {
  connection: { label: "Connection", hint: "Where the service lives" },
  credentials: { label: "Credentials", hint: "Write-only — stored server-side, never returned" },
  options: { label: "Options", hint: "Scope and tuning" },
};

export const PROVIDERS: Provider[] = [
  {
    key: "confluence",
    name: "Confluence",
    tagline: "Import wiki spaces into the knowledge base",
    desc: "Connect Confluence Cloud to import pages into the knowledge base. Pages from the listed spaces are chunked, embedded and become answer sources.",
    category: "Knowledge & docs",
    icon: BookOpen,
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net/wiki" },
      {
        key: "email",
        label: "Account Email",
        placeholder: "you@your-domain.com",
        hint: "Required — the Atlassian account that created the token. The token alone cannot authenticate.",
      },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "space_keys", label: "Space Keys (comma separated)", placeholder: "HELP, IT, ENG" },
    ],
  },
  {
    key: "jira",
    name: "Jira",
    tagline: "Auto-create escalation tickets",
    desc: "Connect Jira Cloud to auto-create escalation tickets. The project key is the default target when the assistant escalates a conversation.",
    category: "Work tracking",
    icon: Ticket,
    docs: "https://id.atlassian.com/manage-profile/security/api-tokens",
    fields: [
      { key: "base_url", label: "Base URL", placeholder: "https://your-domain.atlassian.net" },
      {
        key: "email",
        label: "Account Email",
        placeholder: "you@your-domain.com",
        hint: "Required — the Atlassian account that created the token. The token alone cannot authenticate.",
      },
      { key: "api_token", label: "API Token", placeholder: "ATATT3xFfGF0...", isSecret: true },
      { key: "project_key", label: "Default Project Key", placeholder: "ITHD" },
      {
        key: "service_desk_id",
        label: "Service Desk ID (JSM, optional)",
        placeholder: "12",
        hint: "Only for Jira Service Management. Set it (and a request type) to create customer requests instead of a plain Task. Leave blank for a standard project.",
      },
      {
        key: "request_types",
        label: "Request Type IDs by domain (optional)",
        placeholder: '{"server": "101", "network": "102", "general": "100"}',
        multiline: true,
        hint: 'JSON map of domain → JSM request type ID. The "general" key is the fallback when a domain has no entry.',
      },
    ],
  },
  {
    key: "ldap",
    name: "LDAP / Active Directory",
    tagline: "Corporate directory login",
    desc: "Authenticate users against your corporate directory (AD). Used for login plus group-based role mapping.",
    category: "Identity & access",
    icon: Users,
    docs: "https://ldap3.readthedocs.io/",
    fields: [
      { key: "host", label: "LDAP Server Host", placeholder: "ldaps://ad.your-domain.local or 10.10.10.10" },
      { key: "port", label: "Port", placeholder: "389 or 636 (LDAPS)" },
      { key: "bind_dn", label: "Bind DN (service account)", placeholder: "CN=svc-chatbot,OU=Service,DC=corp,DC=local" },
      { key: "bind_password", label: "Bind Password", placeholder: "service account password", isSecret: true },
      { key: "base_dn", label: "Base DN (search root)", placeholder: "DC=corp,DC=local" },
      { key: "user_filter", label: "User Filter", placeholder: "(sAMAccountName={username})" },
    ],
  },
  {
    key: "keycloak",
    name: "Keycloak SSO",
    tagline: "Single sign-on over OpenID Connect",
    desc: "Single sign-on via Keycloak. Users sign in with the realm identity provider instead of local passwords.",
    category: "Identity & access",
    icon: KeyRound,
    docs: "https://www.keycloak.org/documentation",
    fields: [
      { key: "issuer", label: "Issuer / Base URL", placeholder: "https://keycloak-chatbot.drlinuxer.com" },
      { key: "realm", label: "Realm", placeholder: "ith-chatbot" },
      { key: "client_id", label: "Client ID", placeholder: "it-help-chatbot" },
      { key: "client_secret", label: "Client Secret", placeholder: "OIDC client secret", isSecret: true },
      {
        key: "redirect_uri",
        label: "Redirect URI",
        placeholder: "https://chat.example.com/api/auth/sso/callback",
        hint: "Register this exact URL as the client's Valid Redirect URI in Keycloak. The app returns the browser to this origin after sign-in.",
      },
    ],
  },
];

/**
 * DEV BUILD — this deployment runs two connectors: Confluence (documents in) and Jira
 * (tickets out). The other providers stay defined below because their settings still
 * exist server-side and re-appear the moment they are added to this list; hiding them
 * here only stops the UI from offering a sync that has no destination configured.
 */
const BY_KEY = Object.fromEntries(PROVIDERS.map((p) => [p.key, p])) as Record<ProviderKey, Provider>;

/** Per-user opt-in map, stored in the user's preference blob. */
const PREF_KEY = "integration_toggles";

/* ============================================================
   SMALL UI PIECES
============================================================ */

function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        on
          ? "border-transparent bg-[var(--primary)]"
          : "border-[var(--border)] bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "size-3.5 rounded-full bg-white shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-[3px]",
        ].join(" ")}
      />
    </button>
  );
}

function StatusChip({ configured, enabled }: { configured?: boolean; enabled?: boolean }) {
  if (enabled) {
    return (
      <span
        title="This tool is on: its panel is available to you."
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)]/12 px-2 py-1 text-2xs font-semibold text-[var(--primary)]"
      >
        <CheckCircle2 className="size-3" aria-hidden /> In use
      </span>
    );
  }
  if (configured === undefined) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1 text-2xs font-medium text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Checking
      </span>
    );
  }
  return configured ? (
    <span
      title="Credentials are stored on the server. Switch this on to add its panel."
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ok)]/12 px-2 py-1 text-2xs font-semibold text-[var(--ok)]"
    >
      <CheckCircle2 className="size-3" aria-hidden /> Configured
    </span>
  ) : (
    <span
      title="No credentials stored yet — open the panel to add them."
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--warn)]/12 px-2 py-1 text-2xs font-semibold text-[var(--warn)]"
    >
      <span className="size-1.5 rounded-full bg-[var(--warn)]" aria-hidden /> Not set up
    </span>
  );
}

function ProviderEditor({ provider, onConfigured }: {
  provider: Provider;
  onConfigured: (key: ProviderKey, configured: boolean) => void;
}) {
  // `form` holds ONLY newly typed values. Stored values are never loaded into it
  // (the API does not return them), so Save can never re-submit a placeholder.
  const [form, setForm] = useState<Record<string, string>>({});
  const [fieldsSet, setFieldsSet] = useState<string[]>([]);
  const [secretFields, setSecretFields] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [clearing, setClearing] = useState(false);
  const [tokenSet, setTokenSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getIntegrationSettings(provider.key);
      setForm({});
      setReplacing({});
      let set = res.fields_set || [];
      /* Multi-site: a provider can be fully configured with its credentials living on the
         connection rows instead of the legacy single-site settings. Without this the panel
         kept saying "Not set up" after an admin added three sites. */
      if (provider.key === "confluence" || provider.key === "jira") {
        try {
          const conns = await listConnections(provider.key);
          if ((conns.connections ?? []).length > 0) set = set.length ? set : ["connections"];
        } catch {
          /* the connection list is an enhancement, not a requirement */
        }
      }
      setFieldsSet(set);
      setSecretFields(res.secret_fields || []);
      setUpdatedAt(res.updated_at || null);
      setTokenSet(!!res.token_set || (res.secret_fields || []).length > 0);
      onConfigured(provider.key, set.length > 0);
    } catch {
      setForm({});
      setFieldsSet([]);
      setSecretFields([]);
      setUpdatedAt(null);
      setTokenSet(false);
    } finally {
      setLoading(false);
    }
  }, [provider.key, onConfigured]);

  useEffect(() => {
    setResult(null);
    setRevealed({});
    load();
  }, [load]);

  const isConfigured = (fieldKey: string) => fieldsSet.includes(fieldKey);
  const isEditable = (fieldKey: string) =>
    !isConfigured(fieldKey) || !!replacing[fieldKey] || fieldKey in form;

  async function save() {
    setSaving(true);
    setResult(null);
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(form)) if (typeof v === "string" && v.trim()) payload[k] = v;
    const changed = Object.keys(payload).length;
    try {
      await putIntegrationSettings(provider.key, payload);
      setResult({
        ok: true,
        message: changed
          ? `Saved ${changed} field(s). Run Test to verify the connection.`
          : "Nothing new to save — stored values are unchanged.",
      });
      await load();
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const res = await testIntegration(provider.key);
      setResult(res?.ok
        ? { ok: true, message: `Connected as ${res.user || "user"}` }
        : { ok: false, message: res?.detail || res?.error || "Connection failed" });
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    if (!window.confirm(
      `Remove the stored ${provider.name} configuration?\n\n` +
      "Credentials are write-only, so this is the only way to revoke them. " +
      "The integration stops working until it is configured again."
    )) return;
    setClearing(true);
    setResult(null);
    try {
      await deleteIntegrationSettings(provider.key);
      setResult({ ok: true, message: "Stored configuration removed." });
      await load();
    } catch (e: any) {
      setResult({ ok: false, message: e?.message || "Could not clear the configuration" });
    } finally {
      setClearing(false);
    }
  }



  function renderField(f: Field) {
    const configured = isConfigured(f.key);
    const editable = isEditable(f.key);
    const isSecret = !!f.isSecret || secretFields.includes(f.key);
    const show = !!revealed[f.key];

    return (
      <div key={f.key} className="space-y-1.5">
        <label className="flex items-center gap-2 text-xs font-medium text-foreground">
          {f.label}
          {configured && (
            <span className="inline-flex items-center gap-1 text-2xs text-[var(--ok)]">
              {isSecret ? <Lock className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
              {isSecret ? "Saved — not retrievable" : "Configured"}
            </span>
          )}
        </label>
        {f.hint && <p className="text-2xs leading-relaxed text-muted-foreground">{f.hint}</p>}

        {configured && !editable ? (
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-muted/40 px-3 py-2">
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="select-none font-mono text-xs tracking-widest text-muted-foreground">••••••••</span>
              <span className="ml-auto text-2xs text-muted-foreground">write-only</span>
            </div>
            <button
              type="button"
              onClick={() => setReplacing({ ...replacing, [f.key]: true })}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/50"
              title="Enter a new value for this field"
            >
              <Pencil className="h-3.5 w-3.5" /> Replace
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              {f.multiline ? (
                <textarea
                  rows={3}
                  value={form[f.key] || ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore
                  data-lpignore="true"
                  className="w-full resize-y rounded-xl border border-[var(--border)] bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition placeholder:font-sans placeholder:text-muted-foreground focus:border-[var(--primary)]"
                />
              ) : (
              <input
                type={isSecret && !show ? "password" : (f.type || "text")}
                value={form[f.key] || ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={isSecret && tokenSet ? "leave blank to keep current" : f.placeholder}
                /* Security: an integration token is not a site login. Without these the
                   browser and password managers offer to save it, and autocorrect can
                   ship the value to a third party. */
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 pr-10 font-mono text-xs text-foreground outline-none transition placeholder:font-sans placeholder:text-muted-foreground focus:border-[var(--primary)]"
              />
              )}
              {isSecret && !f.multiline && (
                <button
                  type="button"
                  aria-label={show ? `Hide ${f.label}` : `Reveal ${f.label}`}
                  onClick={() => setRevealed({ ...revealed, [f.key]: !show })}
                  className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                >
                  {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
            {configured && (
              <button
                type="button"
                onClick={() => {
                  setReplacing({ ...replacing, [f.key]: false });
                  const next = { ...form };
                  delete next[f.key];
                  setForm(next);
                }}
                className="mt-1 text-2xs text-muted-foreground underline hover:text-foreground"
              >
                Keep the stored value
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  const groups = GROUP_ORDER
    .map((g) => ({ group: g, fields: provider.fields.filter((f) => groupOf(f.key) === g) }))
    .filter((x) => x.fields.length > 0);
  const dirty = Object.values(form).some((v) => typeof v === "string" && v.trim().length > 0);

  return (
    <section data-slot="card" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card text-card-foreground shadow-xs">
      {/* header */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.04] p-1.5 ring-1 ring-[var(--border)] dark:bg-white/[0.03]">
            <IntegrationLogo providerKey={provider.key} name={provider.name} size="sm" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold leading-tight">{provider.name}</h3>
              <StatusChip configured={loading ? undefined : fieldsSet.length > 0} />
            </div>
            <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">{provider.desc}</p>
          </div>
        </div>
        <a
          href={provider.docs}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-muted"
        >
          Provider docs <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      {/* write-only note — one quiet line, not a second banner */}
      <p className="flex items-start gap-1.5 border-b border-[var(--border)] bg-muted/20 px-5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0 text-[var(--ok)]" aria-hidden />
        <span>
          <b className="font-semibold text-foreground">Write-only credentials.</b> Values are stored server-side and never returned —
          type one only to add or replace it; blank keeps what is stored.
          {updatedAt && <> Last saved {new Date(updatedAt).toLocaleString()}.</>}
        </span>
      </p>

      {/* fields */}
      <div className="space-y-5 px-5 py-4">
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stored configuration…
          </p>
        ) : (
          groups.map(({ group, fields }) => (
            <section key={group}>
              <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-[var(--border)] pb-1.5">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {GROUP_META[group].label}
                </h4>
                <span className="text-2xs text-muted-foreground/70">{GROUP_META[group].hint}</span>
                {group === "credentials" && <Lock className="size-3 text-muted-foreground" />}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {fields.map(renderField)}
              </div>
            </section>
          ))
        )}
      </div>

      {(provider.key === "confluence" || provider.key === "jira") && (
        <div className="border-t border-[var(--border)] px-5 py-3">
          <ConnectionsCard provider={provider.key} />
        </div>
      )}

      {/* actions */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-5 py-3">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-[11px] font-semibold text-[var(--primary-foreground)] transition hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </button>
        <button
          onClick={test}
          disabled={testing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[11px] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LoaderIcon className="h-3.5 w-3.5" />}
          Test connection
        </button>
                {fieldsSet.length > 0 && (
          <button
            onClick={clear}
            disabled={clearing}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-[var(--danger)]/40 px-3 py-1.5 text-[11px] font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10 disabled:opacity-50"
            title="Revoke the stored credentials — the only way to remove a write-only value"
          >
            {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Remove stored settings
          </button>
        )}
      </footer>

      {(dirty || result) && (
        <div className="border-t border-[var(--border)] px-5 py-2.5">
          {dirty && !result && (
            <p className="flex items-center gap-1 text-2xs text-[var(--warn)]">
              <Info className="h-3 w-3" /> Unsaved changes — press Save to store them.
            </p>
          )}
          {result && (
            <p className={["flex items-center gap-1 text-xs", result.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"].join(" ")}>
              {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {result.message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ============================================================
   CATALOGUE — the browse view; everything starts OFF
============================================================ */

function Catalog({ enabled, status, onToggle, onConfigure, personal }: {
  enabled: Record<string, boolean>;
  status: Record<string, boolean>;
  onToggle: (key: ProviderKey, next: boolean) => void;
  onConfigure: (key: ProviderKey) => void;
  personal: boolean;
}) {
  // Admin: a switch would be a lie — credentials either exist (in use) or they do not.
  // Personal: the same tools, and the person picks which ones to keep in their workspace.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "All">("All");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PROVIDERS.filter((p) =>
      (category === "All" || p.category === category) &&
      (!q || `${p.name} ${p.tagline} ${p.category} ${p.desc}`.toLowerCase().includes(q))
    );
  }, [query, category]);

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search integrations"
            placeholder="Search integrations…"
            className="h-9 w-full rounded-xl border border-[var(--border)] bg-background pl-9 pr-3 text-xs text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[var(--primary)]"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-muted/30 p-1">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={[
                "shrink-0 rounded-lg px-2.5 py-1.5 text-2xs font-medium transition",
                category === c
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* cards: 2 x 2 grid on desktop with aligned dimensions & actions */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2">
        {shown.map((p) => {
          const on = !!enabled[p.key];
          return (
            <div
              key={p.key}
              data-integration={p.key}
              className={[
                "group flex min-h-[178px] flex-col justify-between overflow-hidden rounded-xl border bg-card transition duration-150",
                on
                  ? "border-[var(--primary)]/55 shadow-[inset_0_0_0_1px_var(--primary)]/10"
                  : "border-[var(--border)] hover:-translate-y-0.5 hover:border-[var(--primary)]/35 hover:shadow-[var(--elev-2)]",
              ].join(" ")}
            >
              <div className="flex items-start gap-3.5 px-4 pt-4">
                <div
                  className={[
                    "grid size-11 shrink-0 place-items-center rounded-xl p-1.5 transition",
                    on
                      ? "bg-white/[0.06] shadow-xs ring-1 ring-[var(--primary)]/30"
                      : "bg-white/[0.03] ring-1 ring-[var(--border)] group-hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  <IntegrationLogo providerKey={p.key} name={p.name} size="md" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug text-foreground">{p.name}</p>
                    {personal && (
                      <div className="flex shrink-0 flex-col items-center gap-0.5">
                        <Switch on={on} onChange={(next) => onToggle(p.key, next)} label={`Enable ${p.name}`} />
                        <span className={["text-[11px] font-medium uppercase tracking-wide", on ? "text-[var(--primary)]" : "text-muted-foreground/70"].join(" ")}>
                          {on ? "On" : "Off"}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{p.tagline}</p>
                  <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
                    {p.category}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--muted)]/25 px-4 py-3">
                <StatusChip configured={status[p.key]} enabled={on} />
                <div className="flex items-center gap-2">
                  {p.docs && (
                    <a
                      href={p.docs}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-muted-foreground transition hover:text-foreground hover:underline"
                    >
                      View docs <ExternalLink className="size-3" />
                    </a>
                  )}
                  {on && !personal ? (
                    <button
                      type="button"
                      onClick={() => onConfigure(p.key)}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-2xs font-semibold text-white transition hover:opacity-90"
                    >
                      Configure <ChevronRight className="size-3" />
                    </button>
                  ) : on ? (
                    <span className="shrink-0 text-2xs text-muted-foreground">Set up by admin</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onConfigure(p.key)}
                      className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-2xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    >
                      Configure <ChevronRight className="size-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center">
          <p className="text-xs text-muted-foreground">No integration matches “{query}”.</p>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-2xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        {personal
          ? "Switching a tool on keeps it available in your workspace; the connection itself is configured once by an administrator. Your choices are personal and never affect other people."
          : "Switching a provider on adds its configuration panel for you only. It never disables the integration for other users, and switching it off keeps the stored credentials until you remove them inside the panel."}
      </p>
    </div>
  );
}

/* ============================================================
   PANEL
============================================================ */

export function IntegrationsConfig({ variant = "admin" }: { variant?: "admin" | "personal" }) {
  // `personal` is what a non-admin sees: the same per-user opt-in map, but no
  // credential editor — connections are configured once by an administrator, and
  // a member only chooses which of the available tools to keep in their workspace.
  const personal = variant === "personal";
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<ProviderKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  // Load the per-user opt-in map (falls back to an empty map = everything off).
  useEffect(() => {
    let mounted = true;
    getMySettings()
      .then((s: any) => {
        if (!mounted) return;
        const all: Record<string, any> = s?.settings && typeof s.settings === "object"
          ? { ...s.settings, ...s }
          : { ...s };
        setPrefs(all);
        const map = all?.[PREF_KEY];
        const clean: Record<string, boolean> = {};
        if (map && typeof map === "object") {
          for (const p of PROVIDERS) if (map[p.key] === true) clean[p.key] = true;
        }
        setEnabled(clean);
        const first = PROVIDERS.find((p) => clean[p.key]);
        setSelected(first ? first.key : null);

      })
      .catch(() => { /* the catalogue renders anyway; its toggles start empty */ })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
    // `personal` only decides whether the catalogue opens first; re-running on its
    // change would refetch the user's toggles and discard their current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markConfigured = useCallback((key: ProviderKey, configured: boolean) => {
    setStatus((prev) => (prev[key] === configured ? prev : { ...prev, [key]: configured }));
    if (!configured || personal) return;
    // Saving credentials turns the integration on — the two states are the same fact.
    setEnabled((prev) => {
      if (prev[key]) return prev;
      const merged = { ...prev, [key]: true };
      void persist(merged);
      return merged;
    });
  }, [personal]);

  // Probe every provider once so the catalogue can show real Configured / Needs setup
  // states. Ten small GETs on open beats showing a placeholder that looks like an answer.
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled(
      PROVIDERS.map(async (p) => {
        const res = await getIntegrationSettings(p.key);
        if ((res.fields_set || []).length > 0) return [p.key, true] as const;
        if (p.key === "confluence" || p.key === "jira") {
          try {
            const conns = await listConnections(p.key);
            return [p.key, (conns.connections ?? []).length > 0] as const;
          } catch {
            return [p.key, false] as const;
          }
        }
        return [p.key, false] as const;
      }),
    ).then((rows) => {
      if (cancelled) return;
      const next: Record<string, boolean> = {};
      for (const r of rows) if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
      setStatus((prev) => ({ ...prev, ...next }));
      if (personal) return; // a member still chooses which tools to keep in their workspace
      // Configured is the switch. Without this, a working install read "0 of 4 enabled"
      // while three providers had credentials — the count contradicted the cards.
      setEnabled((prev) => {
        const merged = { ...prev };
        for (const [key, configured] of Object.entries(next)) if (configured) merged[key] = true;
        const changed = Object.keys(merged).length !== Object.keys(prev).length;
        if (changed) void persist(merged);
        return changed ? merged : prev;
      });
    });
    return () => { cancelled = true; };
  }, []);

  async function persist(next: Record<string, boolean>) {
    setError(null);
    const body = { ...prefs, [PREF_KEY]: next };
    setPrefs(body);
    try {
      await updateMySettings(body as any);
    } catch (e: any) {
      setError(e?.message || "Could not save your integration choices");
    }
  }

  function toggle(key: ProviderKey, next: boolean) {
    const map = { ...enabled };
    if (next) map[key] = true;
    else delete map[key];
    setEnabled(map);
    if (next) {
      // Stay on the catalogue: switching a provider on opens its panel underneath the list
      // instead of replacing it.
      setSelected(key);
    } else if (selected === key) {
      const rest = PROVIDERS.find((p) => map[p.key]);
      setSelected(rest ? rest.key : null);
    }
    void persist(map);
  }

  const activeProvider = selected ? BY_KEY[selected] : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 py-8 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading integrations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-3 py-2 text-[11px] text-[var(--danger)]">
          {error}
        </p>
      )}

      {/* The catalogue is the page. There is no browse mode to enter or leave: the count,
          the search and every provider stay in front of you, and switching one on opens its
          panel below the list rather than taking the list away. */}
      <Catalog
        enabled={enabled}
        status={status}
        onToggle={toggle}
        personal={personal}
        onConfigure={(k) => {
          setSelected(k);
          requestAnimationFrame(() => {
            document.getElementById("integration-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }}
      />

      {!personal && activeProvider && (
        <div id="integration-panel" className="scroll-mt-4">
          <ProviderEditor
            key={activeProvider.key}
            provider={activeProvider}
            onConfigured={markConfigured}
          />
        </div>
      )}
    </div>
  );
}
