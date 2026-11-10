import { ShieldAlert } from "lucide-react";

/**
 * Shown when a page is reachable by URL but not by role.
 *
 * The sidebar already hides (and explains) locked items, but a deep link such as
 * `#/users` used to render the admin page anyway — the API answered 403, so the screen
 * filled with empty tables and error toasts that looked like a bug rather than a rule.
 * The guard lives in App.tsx; this is only the explanation.
 */
export default function AccessRestricted({
  capability,
  roleLabel,
}: {
  /** human name of the capability, e.g. "Manage users, roles & settings" */
  capability: string;
  /** the caller's role, already prettified ("User", "IT Support", …) */
  roleLabel?: string;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-card p-8 text-center shadow-xs">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)]">
          <ShieldAlert className="size-6" />
        </div>
        <h2 className="text-base font-semibold">Access restricted</h2>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">
          {roleLabel ? `Your role (${roleLabel})` : "Your role"} does not have permission:{" "}
          <b>{capability}</b>.
        </p>
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
          Ask an administrator to grant it, or open a page your role can use.
        </p>
      </div>
    </div>
  );
}
