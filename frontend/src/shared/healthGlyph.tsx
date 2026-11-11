/**
 * One glyph per infrastructure dependency, shared by every surface that lists health
 * (chat rail "System status", Overview "System health").
 *
 * The mapping is by what the probe calls the service — never by position — so a new
 * dependency shows a neutral server icon instead of borrowing another service's colour,
 * and the same service looks identical on both pages.
 */
import {
  Boxes, Cpu, Database, FileText, Server, ShieldCheck, SquareKanban, Users, Zap,
} from "lucide-react";

export type HealthGlyph = {
  Icon: typeof Database;
  /** icon colour + tinted background, in one string so callers cannot drift */
  tint: string;
  /** a solid dot colour for the status pip */
  dot: string;
  /** official brand logo key when available */
  brand?: string;
};

const TABLE: { match: RegExp; glyph: HealthGlyph }[] = [
  { match: /postgres|pgvector|database|db$|\bsql\b/i,
    glyph: { Icon: Database, tint: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400", dot: "bg-emerald-500", brand: "postgres" } },
  { match: /redis|cache|broker|queue/i,
    glyph: { Icon: Zap, tint: "text-amber-600 bg-amber-500/10 dark:text-amber-400", dot: "bg-amber-500", brand: "redis" } },
  { match: /jira/i,
    glyph: { Icon: SquareKanban, tint: "text-sky-600 bg-sky-500/10 dark:text-sky-400", dot: "bg-sky-500", brand: "jira" } },
  { match: /confluence|docs?\b|wiki/i,
    glyph: { Icon: FileText, tint: "text-indigo-600 bg-indigo-500/10 dark:text-indigo-400", dot: "bg-indigo-500", brand: "confluence" } },
  { match: /ldap|active directory|\bad\b|directory/i,
    glyph: { Icon: Users, tint: "text-violet-600 bg-violet-500/10 dark:text-violet-400", dot: "bg-violet-500", brand: "ldap" } },
  { match: /keycloak|\bsso\b|auth|identity/i,
    glyph: { Icon: ShieldCheck, tint: "text-rose-600 bg-rose-500/10 dark:text-rose-400", dot: "bg-rose-500", brand: "keycloak" } },
  { match: /ollama|llm|embed|model|openrouter|provider/i,
    glyph: { Icon: Cpu, tint: "text-fuchsia-600 bg-fuchsia-500/10 dark:text-fuchsia-400", dot: "bg-fuchsia-500" } },
  { match: /vector|index|store/i,
    glyph: { Icon: Boxes, tint: "text-teal-600 bg-teal-500/10 dark:text-teal-400", dot: "bg-teal-500" } },
];

const FALLBACK: HealthGlyph = {
  Icon: Server, tint: "text-slate-600 bg-slate-500/10 dark:text-slate-300", dot: "bg-slate-400",
};

export function healthGlyph(key?: string | null, name?: string | null): HealthGlyph {
  const haystack = `${key ?? ""} ${name ?? ""}`;
  return TABLE.find((row) => row.match.test(haystack))?.glyph ?? FALLBACK;
}
