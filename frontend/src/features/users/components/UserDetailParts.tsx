/**
 * Presentational pieces of the user-details drawer.
 *
 * Kept out of `UsersPage.tsx` so the drawer's markup (metadata grid, notice cards,
 * permission rows, password form) can be read and changed without scrolling through the
 * directory table. None of these components fetch or own state.
 */
import type { ReactNode } from "react";
import { Check, KeyRound, Minus, RotateCcw } from "lucide-react";

import { setUserPassword } from "@/features/users/api";
import { useEffect, useState } from "react";

/* ---------------------------------------------------------------- section heading */

export function SectionHeading({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--primary)]" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-xs font-semibold leading-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-xs leading-4 text-muted-foreground">{hint}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------- metadata grid */

export function MetaGrid({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2">
      {children}
    </dl>
  );
}

export function MetaItem({
  icon,
  label,
  value,
  mono = false,
  title,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="flex items-center gap-1 text-[14px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd
        className={["mt-1 truncate text-xs font-medium text-foreground", mono ? "font-mono text-xs" : ""].join(" ")}
        title={title ?? (typeof value === "string" ? value : undefined)}
      >
        {value}
      </dd>
    </div>
  );
}

/* ---------------------------------------------------------------- notice card */

const NOTICE_TONES = {
  warning: {
    box: "border-[var(--warn)]/35 bg-[var(--warn)]/8",
    tile: "bg-[var(--warn)]/15 text-[var(--warn)]",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
  info: {
    box: "border-[var(--border)] bg-[var(--muted)]/40",
    tile: "bg-[var(--accent-soft)] text-[var(--primary)]",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
  danger: {
    box: "border-[var(--danger)]/35 bg-[var(--danger)]/8",
    tile: "bg-[var(--danger)]/12 text-[var(--danger)]",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
} as const;

export function NoticeCard({
  tone = "info",
  icon,
  title,
  children,
  footer,
}: {
  tone?: keyof typeof NOTICE_TONES;
  icon: ReactNode;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = NOTICE_TONES[tone];
  return (
    <div className={["rounded-xl border p-3", t.box].join(" ")}>
      <div className="flex gap-2.5">
        <span className={["grid size-7 shrink-0 place-items-center rounded-lg", t.tile].join(" ")} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={["text-xs font-semibold", t.title].join(" ")}>{title}</p>
          <div className={["mt-1 text-xs leading-4", t.body].join(" ")}>{children}</div>
          {footer && <div className="mt-2">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- permissions */

export type PermissionRow = {
  key: string;
  label: string;
  enabled: boolean;
  /** Only true when the preview differs from what the account has today. */
  changed: boolean;
};

export function PermissionMatrix({ rows, loading }: { rows: PermissionRow[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const granted = rows.filter((r) => r.enabled).length;

  return (
    <div>
      <div className="grid grid-cols-1 gap-1.5">
        {rows.map((row) => (
          <div
            key={row.key}
            data-slot="permission-row"
            data-enabled={row.enabled ? "true" : "false"}
            className={[
              "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5",
              row.changed
                ? row.enabled
                  ? "border-[var(--ok)]/40 bg-[var(--ok)]/8"
                  : "border-[var(--danger)]/35 bg-[var(--danger)]/6"
                : "border-transparent bg-muted/40",
            ].join(" ")}
            title={row.changed ? (row.enabled ? "Gains this capability" : "Loses this capability") : undefined}
          >
            <span
              className={[
                "grid size-4 shrink-0 place-items-center rounded-full",
                row.enabled ? "bg-[var(--ok)]/15 text-[var(--ok)]" : "bg-[var(--border)] text-muted-foreground",
              ].join(" ")}
              aria-hidden
            >
              {row.enabled ? <Check className="size-2.5" /> : <Minus className="size-2.5" />}
            </span>
            <span className={["truncate text-xs", row.enabled ? "font-medium text-foreground" : "text-muted-foreground"].join(" ")}>
              {row.label}
            </span>
            {row.changed && (
              <span className="ml-auto shrink-0 text-[14px] font-semibold uppercase tracking-wide">
                {row.enabled ? <span className="text-[var(--ok)]">new</span> : <span className="text-[var(--danger)]">lost</span>}
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {granted} of {rows.length} capabilities {loading ? "" : "in this preview"}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- password */

export function LocalPasswordForm({ username }: { username: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooShort = password.length > 0 && password.length < 8;

  // Clear a stale success message as soon as the user starts typing again.
  useEffect(() => {
    if (password) {
      setMessage(null);
      setError(null);
    }
  }, [password]);

  async function savePassword() {
    if (password.length < 8) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      await setUserPassword(username, password);
      setPassword("");
      setMessage("Password updated");
    } catch (err: any) {
      setError(err?.message || "Failed to update password.");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <label htmlFor="new-password" className="block text-xs font-semibold text-muted-foreground">
        New password
      </label>
      <input
        id="new-password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="At least 8 characters"
        aria-label="New password"
        aria-invalid={tooShort}
        aria-describedby="new-password-hint"
        className={[
          "h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none transition focus:ring-2 focus:ring-[var(--primary)]/15",
          tooShort ? "border-[var(--danger)]" : "border-[var(--border)] focus:border-[var(--primary)]",
        ].join(" ")}
      />
      <div className="flex items-center justify-between gap-2">
        <p id="new-password-hint" className="min-w-0 text-xs">
          {tooShort ? (
            <span className="text-[var(--danger)]">Use at least 8 characters.</span>
          ) : message ? (
            <span className="text-[var(--ok)]">{message}</span>
          ) : error ? (
            <span className="text-[var(--danger)]">{error}</span>
          ) : (
            <span className="text-muted-foreground">8+ characters. Applied immediately.</span>
          )}
        </p>
        <button
          type="button"
          onClick={savePassword}
          disabled={busy || password.length < 8}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-foreground)] shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <KeyRound className="size-3" aria-hidden />
          {busy ? "Updating…" : "Update password"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- small action */

export function ResetLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
    >
      <RotateCcw className="size-3" aria-hidden />
      {label}
    </button>
  );
}
