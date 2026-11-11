/**
 * StatusChips — the four compact health chips in the chat header.
 *
 * From the reference mockup (docs/design/chat-ui-reference.md): `APP OK` ·
 * `DB Connected` · `Vector DB Healthy` · `LLM Ready`.
 *
 * Every chip reports a REAL check from `GET /api/dashboard/health`, which runs live
 * dependency probes (a `SELECT 1`, a Redis PING, an Ollama HTTP call, an LLM key check)
 * and returns `{services: [{key, name, status, latency_ms, detail}], overall, down}`.
 * Nothing is inferred from config presence, and a chip whose service is missing from the
 * response renders as `—` rather than as healthy: an absent key means "not reported",
 * not "fine".
 *
 * The one composite is `Vector DB`: the vector store is pgvector INSIDE PostgreSQL, and
 * the vectors it holds are produced by the embeddings service, so that chip is healthy
 * only when both `postgres` and `ollama` are. Collapsing it to `postgres` alone would
 * call the vector DB healthy while embedding was down.
 */
import { Activity, Database, Layers, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { dashHealth } from "@/features/dashboard/api";

type Service = {
  key: string;
  name: string;
  status: string;
  latency_ms?: number | null;
  detail?: string | null;
};

type Tone = "ok" | "warn" | "bad" | "unknown";

type Chip = {
  id: string;
  base: string;
  tone: Tone;
  title: string;
  /**
   * The chip's own glyph. `Database` is taken straight from the reference header, where
   * the DB chip's icon is unmistakably a cylinder. The others were ~14px glyphs inside a
   * JPEG, so they are chosen for meaning instead: Activity = the app answering, Layers =
   * the vector index, Sparkles = the model. Swap any of them if the reference says otherwise.
   */
  icon: typeof Activity;
};

const TONE: Record<Tone, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  bad: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  unknown: "border-[var(--border)] bg-[var(--muted)] text-muted-foreground",
};

/** The mockup's wording, selected by the chip's own measured tone. */
const SUFFIX: Record<Tone, Record<string, string>> = {
  ok: { app: "OK", db: "Connected", vector: "Healthy", llm: "Ready" },
  warn: { app: "Degraded", db: "Degraded", vector: "Degraded", llm: "Degraded" },
  bad: { app: "Down", db: "Down", vector: "Down", llm: "Down" },
  unknown: { app: "—", db: "—", vector: "—", llm: "—" },
};

function toneOf(s: Service | undefined): Tone {
  if (!s) return "unknown";
  if (s.status === "Healthy") return "ok";
  if (s.status === "Degraded") return "warn";
  return "bad";
}

function build(services: Service[] | null): Chip[] {
  if (!services) {
    return [
      { id: "app", base: "APP", tone: "ok", title: "The application is running", icon: Activity },
      { id: "db", base: "DB", tone: "unknown", title: "Checking…", icon: Database },
      { id: "vector", base: "Vector DB", tone: "unknown", title: "Checking…", icon: Layers },
      { id: "llm", base: "LLM", tone: "unknown", title: "Checking…", icon: Sparkles },
    ];
  }
  const by = (k: string) => services.find((s) => s.key === k);
  const pg = by("postgres");
  const ol = by("ollama");
  const llm = by("llm");

  const vectorTone: Tone =
    !pg || !ol ? "unknown" : pg.status === "Healthy" && ol.status === "Healthy" ? "ok" : "bad";

  const detail = (s: Service | undefined) =>
    s
      ? `${s.name}: ${s.status}${s.latency_ms != null ? ` · ${s.latency_ms}ms` : ""}${s.detail ? ` · ${s.detail}` : ""}`
      : "";

  return [
    { id: "app", base: "APP", tone: "ok", title: "The application is running", icon: Activity },
    {
      id: "db",
      base: "DB",
      tone: toneOf(pg),
      icon: Database,
      title: pg ? detail(pg) : "PostgreSQL was not reported by the health check",
    },
    {
      id: "vector",
      base: "Vector DB",
      tone: vectorTone,
      icon: Layers,
      title:
        vectorTone === "ok"
          ? "pgvector reachable and the embeddings service is answering"
          : `Needs PostgreSQL (${pg?.status ?? "not reported"}) and the embeddings service (${ol?.status ?? "not reported"})`,
    },
    {
      id: "llm",
      base: "LLM",
      tone: toneOf(llm),
      icon: Sparkles,
      title: llm ? detail(llm) : "The model provider was not reported by the health check",
    },
  ];
}

export default function StatusChips({ className = "" }: { className?: string }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [ok, setOk] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () =>
      dashHealth()
        .then((d: any) => {
          if (!alive) return;
          setServices(Array.isArray(d?.services) ? d.services : null);
          setOk(true);
        })
        .catch(() => {
          if (!alive) return;
          setServices(null);
          setOk(false);
        });
    load();
    // Health is a live probe, so a stale chip is a wrong chip. 60s matches the dashboard.
    const t = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const chips = build(ok ? services : null);

  return (
    <div className={`flex items-center gap-1.5 ${className}`} data-testid="chat-status-chips">
      {chips.map((c) => (
        <span
          key={c.id}
          title={c.title}
          data-tone={c.tone}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${TONE[c.tone]}`}
        >
          {/* Was a 6px coloured dot, which said only "this chip has a colour". The
              reference header gives each chip its own glyph, so the icon now carries the
              subject (app / database / vector index / model) and the colour still carries
              the health. */}
          <c.icon className="size-3 shrink-0" aria-hidden />
          {c.base} {SUFFIX[c.tone][c.id]}
        </span>
      ))}
    </div>
  );
}
