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
import { useEffect, useState } from "react";
import {
  AlertCircle, Check, CheckCircle2, ExternalLink, Info, Loader2, Lock, Mail, Pencil,
  Save, Send, ShieldCheck,
} from "lucide-react";

import { getSmtpSettings, putSmtpSettings, sendTestEmail } from "@/features/settings/api";
import {
  BTN_GHOST, BTN_PRIMARY, Eyebrow, Field, FieldGrid, INPUT, Panel, Pill, Row,
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
  const [alerts, setAlerts] = useState<Record<string, boolean>>({
    approval_request: true, ticket_created: true, ticket_status_change: true,
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

  useEffect(() => {
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
        if (s.alerts && typeof s.alerts === "object")
          setAlerts({ approval_request: true, ticket_created: true, ticket_status_change: true, ...s.alerts });
        setPasswordSet(!!s.password_set);
      })
      .catch(() => setError("Failed to load mail settings"))
      .finally(() => setLoading(false));
  }, []);

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
        alerts,
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
              <span className="ml-auto text-xs text-muted-foreground">write-only</span>
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

  const tlsOn = form.use_tls;
  const hostKnown = smtpConfigured("host") || !!form.host.trim();

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        {/* status hero */}
        <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
          <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-4 pt-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-foreground)]">
                <Mail className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">Mail (SMTP)</h2>
                  {form.enabled
                    ? <Pill tone="ok"><CheckCircle2 className="size-3" /> Alerts on</Pill>
                    : <Pill tone="muted">Alerts off</Pill>}
                  {hostKnown
                    ? <Pill tone="ok"><Lock className="size-3" /> Host stored</Pill>
                    : <Pill tone="warn"><AlertCircle className="size-3" /> Host missing</Pill>}
                </div>
                <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                  Outgoing server for escalation and ticket notifications.
                  {tlsOn ? " STARTTLS on." : " TLS off — credentials travel in clear text."}
                </p>
              </div>
            </div>
            <a
              href="https://support.google.com/accounts/answer/185833"
              target="_blank"
              rel="noreferrer"
              className={`shrink-0 ${BTN_GHOST}`}
            >
              App password help <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border)] bg-muted/25 px-5 py-2 text-[14px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ServerIcon /> {form.host || (smtpConfigured("host") ? "stored host" : "no host")}:{form.port || "—"}
            </span>
            <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3" /> {form.use_tls ? "STARTTLS" : "no TLS"}</span>
            <span className="ml-auto hidden sm:inline">{smtpSet.length} stored field{smtpSet.length === 1 ? "" : "s"}</span>
          </div>
        </section>

        <Panel
          icon={<Mail className="size-4" />}
          title="Server"
          description="Where mail is handed off, and how the connection is secured."
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
            </>
          )}
        </Panel>

        <Panel
          icon={<ShieldCheck className="size-4" />}
          title="Credentials & sender"
          description="Write-only: stored server-side, never returned, and only replaced when you type a new value."
        >
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
        </Panel>

        <Panel
          icon={<AlertCircle className="size-4" />}
          title="Alert emails"
          description="Which events send mail. Each one is independent of the master switch above."
        >
          <Row title="Escalation awaiting approval" hint="Sent to administrators when a human-in-the-loop approval is requested.">
            <Switch checked={!!alerts.approval_request} onChange={(v) => setAlerts({ ...alerts, approval_request: v })} label="Escalation awaiting approval" />
          </Row>
          <Row title="Ticket created" hint="Sent to the requester when a Jira ticket is opened.">
            <Switch checked={!!alerts.ticket_created} onChange={(v) => setAlerts({ ...alerts, ticket_created: v })} label="Ticket created" />
          </Row>
          <Row title="Ticket status changed" hint="Sent when a ticket moves (open → pending → resolved…).">
            <Switch checked={!!alerts.ticket_status_change} onChange={(v) => setAlerts({ ...alerts, ticket_status_change: v })} label="Ticket status changed" />
          </Row>
          <div className="border-t border-[var(--border)] px-5 py-3">
            <Eyebrow hint="Gmail: use a 16-character App Password, not the account password">Sender notes</Eyebrow>
            <p className="flex items-start gap-1.5 text-[14px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              Gmail requires 2-Step Verification and an App Password (Google Account → Security → App passwords).
              Host smtp.gmail.com, port 587, TLS on.
            </p>
          </div>
        </Panel>
      </div>

      {/* rail: what this server resolves to, and the two actions that prove it works */}
      <aside className="space-y-4 xl:sticky xl:top-6">
        <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
          <h2 className="text-sm font-semibold">Delivery</h2>
          <p className="mt-0.5 text-[14px] text-muted-foreground">How mail leaves this deployment.</p>
          <dl className="mt-3 space-y-2.5">
            {[
              ["Server", `${form.host || (smtpConfigured("host") ? "stored" : "not set")}:${form.port || "—"}`],
              ["Encryption", form.use_tls ? "STARTTLS" : "None"],
              ["Sender", form.from || (smtpConfigured("from_address") ? "stored" : "not set")],
              ["Alerts", form.enabled ? "On" : "Off"],
              ["Alerts wired", `${Object.values(alerts).filter(Boolean).length} of 3 events`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[14px]">
                <dt className="shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium" title={v}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-2xl border border-[var(--border)] bg-card p-4">
          <h2 className="text-sm font-semibold">Send &amp; save</h2>
          <p className="mt-0.5 text-[14px] leading-relaxed text-muted-foreground">
            Save stores the write-only fields; the test proves the saved server actually delivers.
          </p>

          <Field label="Send a test email to" className="mt-3">
            <input
              className={INPUT}
              value={testTo}
              placeholder={form.username || "you@drlinuxer.com"}
              onChange={(e) => setTestTo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") sendTest(); }}
              aria-label="Send a test email to"
            />
          </Field>

          <button onClick={sendTest} disabled={testing} className={`${BTN_GHOST} mt-2 w-full justify-center`}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            {testing ? "Sending…" : "Send test"}
          </button>
          <button onClick={save} disabled={saving} className={`${BTN_PRIMARY} mt-2 w-full justify-center`}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? "Saving…" : "Save mail settings"}
          </button>

          <div className="mt-3 space-y-1.5">
            {saved && (
              <p className="flex items-center gap-1 text-[14px] font-medium text-[var(--ok)]">
                <Check className="size-3.5" /> Mail settings saved
              </p>
            )}
            {testMsg && <p className="text-[14px] font-medium text-[var(--ok)]">{testMsg}</p>}
            {error && (
              <p className="flex items-start gap-1 text-[14px] font-medium text-[var(--danger)]">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
            {smtpSet.length > 0 && (
              <p className="inline-flex items-center gap-1 text-[14px] text-muted-foreground">
                <Lock className="size-3" /> {smtpSet.length} stored field{smtpSet.length === 1 ? "" : "s"} · write-only
              </p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

/** The SMTP chip in the status strip — same weight as the other tiny icons. */
function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3">
      <rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
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

