/**
 * One routing domain, as a card.
 *
 * Information order is deliberate: identity (icon + name + key) → state (active, Jira) →
 * what the classifier needs (keywords) → what the reader can do (edit / delete). Tags are
 * capped at six with an explicit "+N more" so a domain with 40 keywords cannot dominate
 * the list, and the action buttons keep a 36px target on touch.
 */
import { CheckCircle2, ChevronDown, ChevronUp, Edit2, Route, Tag, Trash2, XCircle } from "lucide-react";
import { useState } from "react";

import type { ClassifierDomainItem } from "@/features/domains/api";
import { domainColor, domainIcon } from "@/features/domains/components/domainMeta";

const VISIBLE_KEYWORDS = 6;

export function DomainRoutingItem({
  domain,
  canManage,
  onEdit,
  onDelete,
}: {
  domain: ClassifierDomainItem;
  canManage: boolean;
  onEdit: (domain: ClassifierDomainItem) => void;
  onDelete: (domain: ClassifierDomainItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = domainIcon(domain);
  const color = domainColor(domain);
  const keywords = domain.keywords ?? [];
  const shown = expanded ? keywords : keywords.slice(0, VISIBLE_KEYWORDS);

  return (
    <article className="group px-4 py-4 transition hover:bg-muted/30 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <span className={["grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl", color.bgClass].join(" ")} aria-hidden>
          {domain.custom_icon ? (
            <img src={domain.custom_icon} alt="" className="size-full object-contain p-1.5" />
          ) : (
            <Icon className={["size-5", color.textClass].join(" ")} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-tight">{domain.display_name}</h3>
            <code className="rounded-md bg-[var(--muted)] px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
              {domain.domain_key}
            </code>

            {domain.is_active ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ok)]/12 px-2 py-0.5 text-2xs font-medium text-[var(--ok)]">
                <CheckCircle2 className="size-3" aria-hidden /> Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-2xs font-medium text-muted-foreground">
                <XCircle className="size-3" aria-hidden /> Inactive
              </span>
            )}

            {domain.jira_project ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-[var(--accent-foreground)]/25 bg-[var(--accent-soft)] px-2 py-0.5 text-2xs font-medium text-[var(--accent-foreground)]"
                title="Jira escalation project"
              >
                <Route className="size-3" aria-hidden /> {domain.jira_project}
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-[var(--warn)]/35 px-2 py-0.5 text-2xs font-medium text-[var(--warn)]"
                title="Questions in this domain cannot be escalated to Jira"
              >
                <Route className="size-3" aria-hidden /> No Jira route
              </span>
            )}
          </div>

          {domain.description ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {domain.description}
            </p>
          ) : (
            <p className="mt-1.5 text-2xs italic text-[var(--warn)]">
              No description — the classifier only sees the keywords.
            </p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {keywords.length > 0 && (
              <span className="mr-0.5 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground">
                <Tag className="size-3" aria-hidden />
                {keywords.length} keyword{keywords.length === 1 ? "" : "s"}
              </span>
            )}

            {shown.map((kw) => (
              <span
                key={kw}
                className="rounded-md border border-[var(--border)] bg-background px-1.5 py-0.5 text-2xs text-muted-foreground"
              >
                {kw}
              </span>
            ))}

            {keywords.length > VISIBLE_KEYWORDS && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-2xs font-medium text-[var(--accent-foreground)] transition hover:bg-[var(--accent-soft)]"
              >
                {expanded ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
                {expanded ? "Show less" : `+${keywords.length - VISIBLE_KEYWORDS} more`}
              </button>
            )}

            {keywords.length === 0 && (
              <span className="rounded-md border border-[var(--warn)]/35 px-1.5 py-0.5 text-2xs text-[var(--warn)]">
                No keywords — this domain can never match
              </span>
            )}
          </div>

        </div>

        {canManage && (
          <div className="flex shrink-0 items-center gap-1.5 self-stretch border-t border-[var(--border)] pt-3 sm:self-start sm:border-0 sm:pt-0">
            <button
              type="button"
              onClick={() => onEdit(domain)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium transition hover:bg-muted sm:h-8 sm:flex-none"
              aria-label={`Edit ${domain.display_name}`}
            >
              <Edit2 className="size-3.5" aria-hidden />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(domain)}
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-xs font-medium text-[var(--danger)] transition hover:bg-[var(--danger)]/10 sm:h-8 sm:flex-none"
              aria-label={`Delete ${domain.display_name}`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
