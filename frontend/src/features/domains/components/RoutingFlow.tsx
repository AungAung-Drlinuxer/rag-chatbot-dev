/**
 * The two steps a routing domain performs, as a flow.
 *
 * Desktop: two equal cards with a connector between them. Mobile: the same order stacked
 * with a vertical rule, so the sequence still reads as a sequence instead of two boxes.
 */
import { ArrowRight, BookOpen, Ticket } from "lucide-react";
import type { ReactNode } from "react";

function Step({
  index,
  title,
  body,
  icon,
}: {
  index: string;
  title: string;
  body: ReactNode;
  icon: ReactNode;
}) {
  return (
    <div className="relative flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-foreground)]">
          {icon}
        </span>
        <span className="mt-2 hidden h-full w-px bg-[var(--border)] sm:block" aria-hidden />
      </div>
      <div className="min-w-0 pb-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Step {index}
        </p>
        <h3 className="mt-1 text-sm font-semibold leading-snug">{title}</h3>
        <p className="mt-1.5 max-w-[52ch] text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export function RoutingFlow() {
  return (
    <section
      aria-label="How routing works"
      className="rounded-2xl border border-[var(--border)] bg-muted/25 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">How a question is routed</h2>
        <p className="text-xs text-muted-foreground">Keywords pick the domain · Jira takes the escalation</p>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-start sm:gap-4">
        <Step
          index="01"
          icon={<BookOpen className="size-4" />}
          title="Retrieve from the domain's knowledge"
          body="A keyword match selects the domain. The assistant retrieves that domain's knowledge base articles to answer the question."
        />

        <div className="hidden items-center justify-center pt-3 text-muted-foreground sm:flex" aria-hidden>
          <ArrowRight className="size-4" />
        </div>

        <Step
          index="02"
          icon={<Ticket className="size-4" />}
          title="Escalate to the mapped Jira project"
          body="When the answer is missing and the user asks for a human, the ticket is created in the domain's Jira project with the question attached."
        />
      </div>
    </section>
  );
}
