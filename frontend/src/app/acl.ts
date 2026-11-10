/**
 * Page-level ACL — which capability a page needs.
 *
 * The sidebar hides nothing (locked items stay visible and explain themselves), so the
 * only thing standing between a `user` and `#/users` was the API's 403. A deep link
 * therefore rendered an admin screen full of empty tables: it looked broken instead of
 * forbidden. `denied()` turns that into one honest screen.
 *
 * A missing capability (`undefined`) is NOT a denial: permissions arrive with /api/me,
 * and blocking during that window would flash "Access restricted" on every reload.
 */
export const NAV_CAPABILITY: Record<string, { cap: string; label: string }> = {
  users: { cap: "manage_users", label: "Manage users, roles & settings" },
  history: { cap: "manage_users", label: "Review organization conversation history" },
  audits: { cap: "manage_users", label: "View platform audit trail" },
  domains: { cap: "manage_domains", label: "Manage classification domains & Jira routing" },
};

export type Denial = { cap: string; label: string } | null;

/** The capability that blocks `nav` for these permissions, or null when it is allowed. */
export function denied(
  nav: string,
  perms: Record<string, boolean> | undefined | null,
): Denial {
  const need = NAV_CAPABILITY[nav];
  if (!need || !perms) return null;
  return perms[need.cap] === false ? need : null;
}
