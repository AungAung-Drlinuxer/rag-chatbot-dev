/**
 * Email server (SMTP) — admin only.
 *
 * Owns the outgoing mail configuration: smarthost + port + TLS, the write-only account
 * credentials, the From address, and which events raise an alert email. One panel, one
 * Save, plus a test send that proves the credentials actually work before anyone relies
 * on them for escalation alerts.
 *
 * Stored values are write-only (the API returns a mask): a configured field is rendered
 * as a locked row and must be explicitly replaced, and only typed values are submitted.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, ExternalLink, Loader2, Lock, Mail, Pencil,
  Save, Send,
} from "lucide-react";

import { getSmtpSettings, putSmtpSettings, sendTestEmail } from "@/features/settings/api";
import {
  BTN_GHOST, BTN_PRIMARY, Field, FieldGrid, INPUT, Panel, Pill, RailCard, Row, SectionProblem, SectionSkeleton,
} from "./SettingsKit";

type Form = {
  host: string; port: number; username: string; password: string; from: string;
  use_tls: boolean; enabled: boolean;
};

export function EmailServerSettings() {
  const [form, setForm] = useState<Form>({
    host: "", port: 587, username: "", password: "", from: "",
    use_tls: true, enabled: true,
  });
  const [passwordSet, setPasswordSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // which mail fields already hold a stored (write-only) value
  const [smtpSet, setSmtpSet] = useState<string[]>([]);
  const [replacingSmtp, setReplacingSmtp] = useState<Record<string, boolean>>({});

  const smtpConfigured = (k: string) => smtpSet.includes(k);
  const smtpEditable = (k: string) =>
    !smtpConfigured(k) || !!replacingSmtp[k] || !!form[k as "host" | "username" | "from"];

  const [loadedOk, setLoadedOk] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getSmtpSettings()
      .then((d) => {
        const s = d.smtp ?? {};
        const set: string[] = (d as any).fields_set ?? [];
        setSmtpSet(set);
        // Sensitive fields (host / username / from-address / password) are write-only
        // and come back masked, so they are NEVER loaded into the form. Only
        // operational knobs are seeded. Typing a value replaces it.
        setForm({
          host: "", port: Number(s.port) || 587,
          username: "", password: "",
          from: "", use_tls: s.use_tls !== false,
          enabled: s.enabled !== false,
        });
        setPasswordSet(!!s.password_set);
        setLoadedOk(true);
        setError(null);
      })
      .catch(() => setError("Failed to load mail settings"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    // A stored (masked) field counts as satisfied — it is write-only, so the admin is
    // not asked to retype the host just to flip a toggle.
    const hostOk = !!form.host.trim() || smtpConfigured("host");
    const fromOk = !!form.from.trim() || smtpConfigured("from_address") || smtpConfigured("from");
    if (!hostOk || !fromOk) { setError("Host and from-address are required."); return; }
    setSaving(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        port: Number(form.port) || 587, use_tls: form.use_tls, enabled: form.enabled,
      };
      // Only send fields the admin actually typed; blank keeps the stored value.
      const MASK_CHARS = "•";
      for (const [k, v] of [
        ["host", form.host], ["username", form.username],
        ["from_address", form.from], ["password", form.password],
      ] as const) {
        const val = (v || "").trim();
        if (val && !val.includes(MASK_CHARS)) body[k] = val;
      }
      await putSmtpSettings(body);
      setPasswordSet(true);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally { setSaving(false); }
  }

  async function sendTest() {
    const to = (testTo.trim() || form.username || form.from);
    if (!to) { setError("Enter a recipient for the test email."); return; }
    setTesting(true); setTestMsg(null); setError(null);
    try {
      const r = await sendTestEmail(to);
      setTestMsg(r.ok ? `Test email sent to ${r.to} — check inbox (and spam) in a minute.` : "Send failed");
    } catch (err: any) {
      setTestMsg(null);
      setError(err?.message || "Test failed — check SMTP settings first");
    } finally { setTesting(false); }
  }

  /** A stored mail field is shown as a mask; Replace unlocks the input. */
  function writeOnlyField(
    fieldKey: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    type: "text" | "password" = "text",
  ) {
    const configured = smtpConfigured(fieldKey);
    const editable = smtpEditable(fieldKey);
    return (
      <Field
        label={label}
        badge={configured ? <Pill tone="ok"><Lock className="size-3" /> saved — not retrievable</Pill> : undefined}
      >
        {configured && !editable ? (
          <div className="flex items-center gap-2">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-[var(--border)] bg-muted/40 px-3">
              <Lock className="size-3 shrink-0 text-muted-foreground" />
              <span className="select-none font-mono text-xs tracking-widest text-muted-foreground">••••••••</span>
              <span className="ml-auto text-2xs text-muted-foreground">write-only</span>
            </div>
            <button
              type="button"
              onClick={() => setReplacingSmtp({ ...replacingSmtp, [fieldKey]: true })}
              className={BTN_GHOST}
              title="Enter a new value"
            >
              <Pencil className="size-3.5" /> Replace
            </button>
          </div>
        ) : (
          <input
            className={INPUT}
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            aria-label={label}
          />
        )}
      </Field>
    );
  }

  const hostKnown = smtpConfigured("host") || !!form.host.trim();

  if (loading && !loadedOk) return <SectionSkeleton rows={4} label="Loading the mail server settings" />;
  if (!loadedOk) {
    return (
      <SectionProblem
        title="Could not load the mail server settings"
        detail={error}
        onRetry={() => { setError(null); load(); }}
      />
    );
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {/* Status card: the same anatomy as an Integrations card — icon tile, one-line
            purpose, state chips, and the three facts the strip used to repeat in the rail. */}
        <Panel
          icon={<Mail className="size-4" />}
          title="Mail (SMTP)"
          description="Outgoing server for escalation and ticket notifications."
          actions={
            <>
              {form.enabled
                ? <Pill tone="ok"><CheckCircle2 className="size-3" /> Alerts on</Pill>
                : <Pill tone="muted">Alerts off</Pill>}
              {hostKnown
                ? <Pill tone="ok"><Lock className="size-3" /> Host stored</Pill>
                : <Pill tone="warn"><AlertCircle className="size-3" /> Host missing</Pill>}
            </>
          }
        >
          <dl className="grid gap-x-6 gap-y-2 px-5 py-3.5 text-[11px] sm:grid-cols-3">
            {[
              ["Server", `${form.host || (smtpConfigured("host") ? "stored host" : "no host")}:${form.port || "—"}`],
              ["Encryption", form.use_tls ? "STARTTLS" : "No TLS — credentials travel in clear text"],
              ["Sender", form.from || (smtpConfigured("from_address") ? "stored" : "not set")],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 sm:block">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium text-foreground sm:mt-0.5 sm:text-left" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel
          icon={<Mail className="size-4" />}
          title="Server & credentials"
          description="Where mail is handed off, how the connection is secured, and who it authenticates as. Stored secrets are write-only."
          actions={
            <a
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noreferrer"
              className={BTN_GHOST}
            >
              App password help <ExternalLink className="size-3" />
            </a>
          }
        >
          {loading ? (
            <p className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading mail settings…
            </p>
          ) : (
            <>
              <div className="space-y-3 p-5">
                <FieldGrid>
                  {writeOnlyField("host", "SMTP host", form.host, (v) => setForm({ ...form, host: v }), "smtp.gmail.com")}
                  <Field label="Port" hint="587 for STARTTLS, 465 for implicit TLS.">
                    <input
                      className={INPUT}
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: Number(e.target.value) || 587 })}
                      aria-label="Port"
                    />
                  </Field>
                </FieldGrid>
              </div>
              <Row title="Enable outgoing mail" hint="Master switch — when off, no alert emails are sent.">
                <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Enable outgoing mail" />
              </Row>
              <Row title="Use TLS (STARTTLS)" hint="Recommended — encrypts the SMTP connection (port 587).">
                <Switch checked={form.use_tls} onChange={(v) => setForm({ ...form, use_tls: v })} label="Use TLS" />
              </Row>
            <div className="border-t border-[var(--border)]" />
            <div className="space-y-3 p-5">
              <FieldGrid>
                {writeOnlyField("username", "Username", form.username, (v) => setForm({ ...form, username: v }), "you@gmail.com")}
                <Field
                  label="Password"
                  badge={passwordSet ? <Pill tone="ok"><Lock className="size-3" /> saved — not retrievable</Pill> : undefined}
                  hint="Leave blank to keep the stored password."
                >
                  <input
                    className={INPUT}
                    type="password"
                    value={form.password}
                    placeholder="16-character app password"
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    aria-label="Password"
                  />
                </Field>
              </FieldGrid>
              {writeOnlyField("from_address", "From address", form.from, (v) => setForm({ ...form, from: v }), "it-helpdesk@your-domain.com")}
            </div>
            </>
          )}
        </Panel>

      </div>

      {/* rail: the two actions that prove the server works. The facts live in the status card. */}
      <aside className="space-y-4 xl:sticky xl:top-6">
        <RailCard
          icon={<Send className="size-4" />}
          title="Send & save"
          description="Save stores the write-only fields; the test proves the server delivers."
        >
          <Field label="Send a test email to">
            <input
              className={INPUT}
              value={testTo}
              placeholder={form.username || "you@drlinuxer.com"}
              onChange={(e) => setTestTo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendTest(); }}
              aria-label="Send a test email to"
            />
          </Field>

          <button onClick={sendTest} disabled={testing} className={`${BTN_GHOST} mt-2.5 w-full justify-center`}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {testing ? "Sending…" : "Send test"}
          </button>
          <button onClick={save} disabled={saving} className={`${BTN_PRIMARY} mt-2 w-full justify-center`}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? "Saving…" : "Save mail settings"}
          </button>

          <div className="mt-3 space-y-1.5">
            {saved && (
              <p className="flex items-center gap-1 text-[11px] font-medium text-[var(--ok)]">
                <Check className="size-3.5" /> Mail settings saved
              </p>
            )}
            {testMsg && <p className="text-[11px] font-medium text-[var(--ok)]">{testMsg}</p>}
            {error && (
              <p className="flex items-start gap-1 text-[11px] font-medium text-[var(--danger)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
            {smtpSet.length > 0 && (
              <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="size-3" /> {smtpSet.length} stored field{smtpSet.length === 1 ? "" : "s"} · write-only
              </p>
            )}
          </div>
        </RailCard>
      </aside>
    </div>
  );
}

/** Small local toggle — same geometry as the Integrations switch, so both read as one system. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-transparent bg-[var(--primary)]" : "border-[var(--border)] bg-muted",
      ].join(" ")}
    >
      <span className={["size-3.5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-[3px]"].join(" ")} />
    </button>
  );
}

