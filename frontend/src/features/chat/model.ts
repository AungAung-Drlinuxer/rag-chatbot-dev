/** Chat feature domain model — message/source types + pure helpers (no React, no fetch). */

export type MsgRole = "user" | "assistant";

export type Source = {
  page_id: string | null;
  title: string;
  space: string;
  relevance: number | null;
  excerpt: string;
  url?: string | null;
};

export type RagTrace = {
  stages: Record<string, number>;
  totalMs: number;
};

/** S1.1 — real retrieval telemetry from the SSE `meta` event (no hardcoded values). */
export type RetrievalInfo = {
  chunks?: number;
  cited?: number;
  top_k?: number;
  rerank_used?: boolean;
  acl_scoped?: boolean;
  role?: string;
};

/** The shape the draft endpoint returns — only fields the create API can honour. */
export type TicketDraft = {
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  domain: string;
  assignee: string | null;
  due_date: string | null;
  /** Any label is legal in Jira, so the model may propose these. */
  labels?: string[];
  /** Components must already exist in the project — only ever set by a human. */
  components?: string[];
  /** Jira time format: "2h", "1d 4h", "30m". */
  original_estimate?: string | null;
};

/** The `done` event carries the LLM usage for the answer that just finished. Copy it onto the
 *  message: without this the pill only appeared after the conversation was reloaded from the
 *  server, so a fresh answer looked like it had never used a token. */
export function withStreamUsage(message: Message, payload: unknown): Message {
  const usage = (payload as { usage?: Record<string, number> } | null)?.usage;
  if (!usage) return message;
  const pick = (k: string) => (typeof usage[k] === "number" ? usage[k] : undefined);
  return {
    ...message,
    usage: {
      input_tokens: pick("input_tokens") ?? message.usage?.input_tokens,
      output_tokens: pick("output_tokens") ?? message.usage?.output_tokens,
      total_tokens: pick("total_tokens") ?? message.usage?.total_tokens,
    },
  };
}

export type Message = {
  id: string;
  role: MsgRole;
  content: string;
  timestamp: string;
  confidence?: number;
  decision?: string;
  /** The routing domain the assistant filed this answer under ("network", "policy", …).
   *  A ticket raised from the answer starts in that category instead of "General". */
  domain?: string;
  topK?: number;
  sources?: Source[];
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  /** Set when the answer came from a deterministic ticket lookup, so the UI can
   *  distinguish a ticket-status answer from a knowledge answer. */
  toolUsed?: string;
  latencyMs?: number;
  serverId?: string;  // v0.21.90 — DB row id from the done event (feedback target)
  feedback?: 1 | -1;  // v0.21.90 — recorded rating (button state)
  ragTrace?: RagTrace;
  retrieval?: RetrievalInfo;  // S1.1 — real retrieval stats for the right panel
  /** Set when the answer is a policy refusal: injection | pii | profanity | toxic | overflow. */
  guardrailType?: string;
  /** An AI-drafted Jira ticket for this answer, waiting for a human to approve it. */
  ticketDraft?: TicketDraft;
  /** Set once the draft became a real issue. */
  createdTicket?: { key: string; link?: string };
};

export type Conv = {
  session_id: string;
  title?: string;
  updated_at?: string;
  last_at?: string;  // S1.3 — ISO timestamp of the newest message (date grouping)
  is_pinned?: boolean;
};

export function currentTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Absolute send time for a bubble — the clock for today's messages, the date as well
 *  for anything older, so a re-opened conversation shows when it was actually said
 *  instead of the moment you looked at it. */
export function formatMessageTime(iso?: string | null): string {
  if (!iso) return currentTime();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return currentTime();
  const now = new Date();
  const clock = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return clock;
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day}, ${clock}`;
}

export function latestSources(messages: Message[]): Source[] {
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const latest = assistantMessages[assistantMessages.length - 1];
  return latest?.sources ?? [];
}

/** S1.1 — retrieval stats of the newest assistant turn that reported them. */
export function latestRetrieval(messages: Message[]): RetrievalInfo | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === "assistant" && m.retrieval) return m.retrieval;
  }
  return null;
}

/** S1.3 — bucket a conversation timestamp for sidebar grouping. */
export function dateBucket(iso?: string): string {
  if (!iso) return "Older";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Older";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  const DAY = 86_400_000;
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (t >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

/**
 * v1.0.1 — compact age for a history row ("2m", "1d", "2d").
 *
 * The reference mockup puts a short age at the end of every history row, which is what
 * lets the eye skip a bucket it does not care about. Deliberately terse: one unit only,
 * largest-first, because the bucket header already carries the coarse date — repeating
 * "Today" in the row would be redundant, and a full timestamp would not fit.
 */
export function relativeAge(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const secs = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** S3.12 — human-friendly label from a login/username (never invents a real name). */
export function prettyName(userName?: string): string {
  const raw = (userName ?? "").split("@")[0];
  if (!raw) return "";
  return raw
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
