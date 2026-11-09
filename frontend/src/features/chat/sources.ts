/**
 * sources.ts — grouping and score labelling for retrieved sources.
 *
 * WHY THIS IS SHARED
 * The answer card ("Sources for this answer") and the right-hand panel list the SAME
 * retrieval result, and the reference mockup gives each entry the same two facts: how
 * many references collapsed into it, and the retrieval match range across them.
 * Deriving those twice is exactly how the two lists start disagreeing — the answer card
 * counted raw rows while the panel counted groups, so one answer read "7 references"
 * next to a list of four.
 *
 * WHAT A GROUP IS
 * The retriever deliberately returns up to 2 chunks per article (`_cap_per_article`)
 * and then expands each winner with its neighbours, so one page_id legitimately appears
 * more than once. Listing it once per chunk showed the reader the same article as two
 * separate sources. The FIRST occurrence is kept, which preserves rank order.
 */
import { type Source } from "@/features/chat/model";

export type SourceGroup = {
  key: string;
  source: Source;
  /** References (retrieved chunks) that collapsed into this entry. */
  count: number;
  /** Retrieval score range across those references; null when none carried a score. */
  min: number | null;
  max: number | null;
};

export function groupSources(sources: Source[]): SourceGroup[] {
  const order: SourceGroup[] = [];
  const byKey = new Map<string, SourceGroup>();
  for (const s of sources) {
    // page_id is the real identity; a ticket row has none, so its title is the key.
    const key = s.page_id ?? `title:${s.title}`;
    const seen = byKey.get(key);
    if (seen) {
      seen.count += 1;
      if (s.relevance != null) {
        seen.min = seen.min == null ? s.relevance : Math.min(seen.min, s.relevance);
        seen.max = seen.max == null ? s.relevance : Math.max(seen.max, s.relevance);
      }
      continue;
    }
    const g: SourceGroup = {
      key,
      source: s,
      count: 1,
      min: s.relevance ?? null,
      max: s.relevance ?? null,
    };
    byKey.set(key, g);
    order.push(g);
  }
  return order;
}

/**
 * The retrieval score as the mockup writes it: one figure, or the range the references
 * spanned ("50-65% match"). Null when nothing scored — a live ticket lookup has no
 * retrieval score, and substituting one would be a number the backend never sent.
 */
export function matchLabel(g: SourceGroup): string | null {
  if (g.min == null || g.max == null) return null;
  return g.min === g.max ? `${g.max}% match` : `${g.min}-${g.max}% match`;
}

/** "4 references" / "1 reference" — pluralised once so both lists agree. */
export function referenceLabel(n: number): string {
  return `${n} reference${n === 1 ? "" : "s"}`;
}

/** "4 grouped references" / "1 reference" — the per-entry line the mockup shows. */
export function groupedReferenceLabel(n: number): string {
  return n > 1 ? `${n} grouped references` : "1 reference";
}

/**
 * Normalise whatever the API called a hit into the `Source` the UI renders.
 *
 * The backend sends `source_url` and a 0..1 `relevance`; the card wants `url` and a
 * whole-number percentage. Leaving that translation to each caller is how the answer
 * card ended up with no links (it looked for `url`) while the widget showed no match
 * (it looked for `score`).
 */
export function toSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((h: any) => {
    const pct =
      h?.relevance != null ? Math.round(Number(h.relevance) * 100)
      : h?.score != null ? Math.round(Number(h.score) * 100)
      : null;
    return {
      page_id: h?.page_id ?? h?.chunk_id ?? null,
      title: h?.title ?? "Knowledge source",
      space: h?.space ?? h?.domain ?? "",
      relevance: pct != null && Number.isFinite(pct) ? pct : null,
      excerpt: h?.excerpt ?? h?.text ?? h?.content ?? "",
      url: h?.source_url ?? h?.url ?? null,
    } satisfies Source;
  });
}
