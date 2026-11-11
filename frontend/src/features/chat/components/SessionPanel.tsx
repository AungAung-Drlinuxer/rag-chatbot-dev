/**
 * SessionPanel — the conversation's "what produced these answers" summary, and the
 * same thing reachable on a phone.
 *
 * WHY THIS REPLACED A DESKTOP-ONLY PANEL
 * The right-hand panel was `hidden … xl:flex`, so on a phone (where this app is most
 * used) its contents were unreachable. It is deliberately a summary, not a second
 * panel — the point is fewer surfaces, not more.
 */
import { History } from "lucide-react";

import { Row } from "@/features/chat/components/chat-parts";

export type SessionSummary = {
  chunks?: number | null;
  cited?: number | null;
  rerankUsed?: boolean | null;
  role?: string | null;
  aclScoped?: boolean | null;
};

export default function SessionPanel({ summary }: { summary: SessionSummary }) {
  return (
    <div className="rounded-xl bg-[var(--muted)] p-3">
      <div className="flex items-center gap-2">
        <History className="size-3.5 text-blue-500" />
        <span className="text-xs font-semibold">Retrieval information</span>
      </div>

      <div className="mt-3 space-y-2 text-xs text-muted-foreground">
          <>
            <Row
              label="Chunks retrieved"
              value={summary.chunks != null ? String(summary.chunks) : "—"}
            />
            <Row label="Sources cited" value={summary.cited != null ? String(summary.cited) : "—"} />
            <Row
              label="Search type"
              value={
                summary.rerankUsed === true
                  ? "Hybrid + rerank"
                  : summary.rerankUsed === false
                    ? "Hybrid (rerank skipped)"
                    : "—"
              }
            />
            <Row label="Role scope" value={summary.role || "—"} />
          </>
      </div>
    </div>
  );
}
