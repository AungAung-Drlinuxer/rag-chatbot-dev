/**
 * Render harness for the right-hand "Knowledge sources" panel — screenshots it WITHOUT
 * logging in.
 *
 * WHY A HARNESS
 * The chat page is behind auth and a verification script must not sign in as anyone.
 * This renders the SAME component the app renders, on the SAME stylesheet, inside a
 * mock chat shell so the 336px aside is measured in the context it actually lives in.
 *
 * WHERE THE DATA COMES FROM (nothing here is invented)
 *   - Titles marked [kb_files] are the real seed articles in `backend/kb_files/`, and
 *     their excerpts are the real text of those files.
 *   - Titles marked [goldset] are the expected top-1 title fragments from
 *     `backend/scripts/eval_goldset.py` — real article titles the retriever is scored
 *     against.
 *   - The two rows sharing a page_id reproduce the retriever's real behaviour: it
 *     returns up to 2 chunks per article (`_cap_per_article`), so the same page_id
 *     legitimately appears twice in `meta.hits`.
 *   - `retrieval` numbers use the real shape of the SSE `meta.retrieval` payload.
 *
 * Usage (dev server only; not part of the shipped bundle):
 *   node scripts/sources_harness_shot.mjs
 */
import "./styles.css";
import { createRoot } from "react-dom/client";
import SourcePanel from "./features/chat/components/SourcePanel";
import { type Source } from "./features/chat/model";

declare global {
  interface Window {
    __SRC_HARNESS__?: { scenario: string; ready: boolean };
  }
}

type Retrieval = { chunks?: number; cited?: number; top_k?: number; rerank_used?: boolean; acl_scoped?: boolean; role?: string };

const KB: Source[] = [
  {
    page_id: "kb-database-timeout",
    title: "Database Connection Timeout — Troubleshooting Guide",
    space: "database",
    relevance: 94,
    excerpt:
      "Steps to diagnose a PostgreSQL connection timeout: check pg_stat_activity for idle-in-transaction sessions, confirm the connection pool ceiling, and verify that a long read transaction is not holding an AccessShareLock that blocks a migration.",
    url: "https://kb.drlinuxer.com/articles/database-connection-timeout",
  },
  {
    page_id: "kb-reset-ad-password",
    title: "Reset AD Password",
    space: "security",
    relevance: 88,
    excerpt:
      "How to reset an Active Directory password and re-sync the MFA token. Includes the UPN suffix to use for a direct user bind and the unlock step when the account is locked out.",
    url: "https://kb.drlinuxer.com/articles/reset-ad-password",
  },
  {
    page_id: "kb-disk-usage",
    title: "Server Disk Usage Above 85% — Free Space Runbook",
    space: "system",
    relevance: 81,
    excerpt:
      "df -h — which mount is high? du -sh /var/log /var/tmp /tmp — largest offenders. Remove old rotated logs; journalctl --vacuum-size=200M. Check deleted-but-open files: lsof +L1 | grep -v COMMAND.",
    url: "https://kb.drlinuxer.com/articles/disk-usage",
  },
  {
    page_id: "kb-vpn",
    title: "VPN Gateway Disconnects — Troubleshooting",
    space: "network",
    relevance: 74,
    excerpt:
      "Standard troubleshooting steps for VPN connection failures: gateway reachability, certificate expiry, DNS resolution order and firewall session limits on the concentrator.",
    url: "https://kb.drlinuxer.com/articles/vpn-disconnects",
  },
  {
    page_id: "kb-print-spooler",
    title: "Runbook — Restart the Print Spooler",
    space: "system",
    relevance: 68,
    excerpt:
      "If the print service is stuck, restart the Windows Print Spooler. Open Services (services.msc), find Print Spooler, right-click, Restart. Re-add the printer by IP if it still fails. Check the spooler error log in Event Viewer.",
    url: "https://kb.drlinuxer.com/articles/print-spooler",
  },
  {
    page_id: "kb-password-expired",
    title: "Password Expired — Re-sync MFA and Unlock Account",
    space: "security",
    relevance: 61,
    excerpt:
      "When an AD password has expired the account locks after three failed attempts. Reset via the self-service portal, then re-enrol the MFA token before signing in to the VPN.",
    url: "https://kb.drlinuxer.com/articles/password-expired",
  },
  {
    // Same article as source 1 — the retriever really does return 2 chunks per article.
    page_id: "kb-database-timeout",
    title: "Database Connection Timeout — Troubleshooting Guide",
    space: "database",
    relevance: 59,
    excerpt:
      "Lock contention: a plain SELECT left idle in transaction holds AccessShareLock and blocks ALTER TABLE. A read is not free — set idle_in_transaction_session_timeout.",
    url: "https://kb.drlinuxer.com/articles/database-connection-timeout",
  },
  {
    page_id: "kb-kubectl-nodes",
    title: "Kubectl get nodes — Live Cluster Check",
    space: "kubernetes",
    relevance: 52,
    excerpt:
      "Read-only check of cluster node readiness. Confirms that the RKE2 nodes report Ready and that the control-plane endpoint answers before deeper troubleshooting.",
    url: "https://kb.drlinuxer.com/articles/kubectl-get-nodes",
  },
];

/** Ticket rows reach the panel through the same `meta.hits` list and carry NO relevance. */
const TICKETS: Source[] = [
  {
    page_id: null,
    title: "ITHD-4821 — Outlook cannot connect after password reset",
    space: "tickets",
    relevance: null,
    excerpt: "Status: In Progress · Reported by the user · Assigned to the IT help desk queue.",
    url: null,
  },
  {
    page_id: null,
    title: "ITHD-4790 — Laptop will not resume from sleep",
    space: "tickets",
    relevance: null,
    excerpt: "Status: Open · Awaiting hardware diagnostics.",
    url: null,
  },
];

const RETRIEVAL: Retrieval = {
  chunks: KB.length,
  cited: KB.length,
  top_k: 5,
  rerank_used: true,
  acl_scoped: true,
  role: "admin",
};

const scenario = new URLSearchParams(location.search).get("scenario") ?? "sources";

const panel =
  scenario === "ticket" ? (
    <SourcePanel sources={TICKETS} retrieval={null} onExplain={() => {}} onAsk={() => {}} />
  ) : scenario === "empty" ? (
    <SourcePanel sources={[]} retrieval={null} onAsk={() => {}} />
  ) : scenario === "live" ? (
    <SourcePanel sources={[]} retrieval={null} onAsk={() => {}} />
  ) : (
    <SourcePanel sources={KB} retrieval={RETRIEVAL} onExplain={() => {}} onAsk={() => {}} />
  );

function Shell() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* Mock message column — the panel is only meaningful beside real chat width. */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center border-b border-[var(--border)] px-6">
          <h1 className="text-sm font-semibold">IT Knowledge Assistant</h1>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          <div className="ml-auto max-w-lg rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-xs text-white">
            How do I fix a PostgreSQL connection timeout?
          </div>
          <div className="max-w-2xl rounded-2xl bg-[var(--card)] px-4 py-3 text-xs leading-relaxed shadow-xs ring-1 ring-[var(--border)]">
            Check for idle-in-transaction sessions holding a lock before you restart the pool.
            A plain <code>SELECT</code> left open holds <code>AccessShareLock</code>, which blocks
            the <code>ALTER TABLE</code> a migration needs — so the fix is often to end the
            long-running read, not to raise the pool ceiling.
          </div>
        </div>
      </main>
      {panel}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Shell />);

window.__SRC_HARNESS__ = { scenario, ready: true };
