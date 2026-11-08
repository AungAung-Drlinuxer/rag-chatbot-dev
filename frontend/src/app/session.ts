/** Session helpers — JWT decode for display (auth itself lives in shared/api/client). */

/** Decode the JWT `sub` claim (username) client-side for display only. */
export function usernameFromToken(tok: string): string {
  try {
    const payload = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub as string;
  } catch {
    return "";
  }
}

/** "Today" / "Yesterday" / "May 13" style relative date for the sidebar list. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sodThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((sod.getTime() - sodThat.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
