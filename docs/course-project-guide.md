# Enterprise RAG IT Helpdesk Platform — Complete Course Guide (မြန်မာလမ်းညွှန်)

> **ရည်ရွယ်ချက်:** ဒီစာတမ်းလုံးလုံးသည် `rag-chatbot` project ကို **zero-to-production** အဖြစ် နားလည်ရန် + ကိုယ်တိုင် ပြန်လည်တည်ဆောက်နိုင်ရန် (lab setup အပါအဝင်) ရေးသားထားသော Course Guide ဖြစ်ပါသည်။
>
> **မှတ်ချက်:** ဒီဖိုင်သည် **သစ်တစ်ခုတည်းသော docs file** ဖြစ်ပြီး project ၏ source code များကို လုံးဝ မပြင်ဆင်ထားပါ။ Code, file path, identifier အားလုံးသည် repository ထဲက အမှန်တရားများအတိုင်း (read-only inspect ဖြင့်) ဖော်ပြထားပါသည်။

---

## 📚 Course Outline (Module အလိုက်)

| Module | ခေါင်းစဉ် | သင်ရမည့်အရာ |
|---|---|---|
| **M0** | Project Orientation | Repo structure၊ component map၊ runtime topology |
| **M1** | Lab Setup | Local dev environment: Python/uv, Node, Docker, Ollama |
| **M2** | Backend FastAPI Core | `main.py`, routers, config, lifespan, pydantic-settings |
| **M3** | PostgreSQL + pgvector | CNPG HA, schema, HNSW/GIN indexes, init_db |
| **M4** | Redis + Celery | Broker/backend, Sentinel HA, beat schedule |
| **M5** | KB Ingestion (Load Generator) | loaders → chunker → ingest → pgvector upsert |
| **M6** | RAG Pipeline — 6 Stages | guardrails → classify/rewrite → hybrid retrieve → rerank → gate → LLM |
| **M7** | LangGraph Orchestration | StateGraph nodes, checkpointer, HITL approval |
| **M8** | LLM Provider + Fallback | OpenRouter primary, Ollama failover, timeouts |
| **M9** | Security Layer | RBAC, API keys, guardrails, rate limiting, LDAP |
| **M10** | Desktop App (React + Tauri) | Vite, Tailwind, features structure, SSE client |
| **M11** | Observability & Deploy | Prometheus metrics, OTel/Tempo, Docker, Harbor, K8s |

---

# M0 — Project Orientation

## 0.1 Repository Structure (အမှန်တရား)

```
rag-chatbot/
├── backend/                  # FastAPI + Celery workers (Python 3.12)
│   ├── app/
│   │   ├── main.py           # FastAPI app entry — routers, lifespan
│   │   ├── config.py         # SETTINGS (pydantic-settings) — env-config driven
│   │   ├── schemas.py        # ChatRequest, FeedbackRequest, EscalateRequest…
│   │   ├── graph_rag.py      # LangGraph StateGraph (RAG orchestration)
│   │   ├── runtime.py        # runtime_kv — hot-tunable knobs (top_k, gate…)
│   │   ├── api/              # HTTP layer (12 routers)
│   │   │   ├── chat.py           # /api/chat/stream — SSE main pipeline
│   │   │   ├── auth.py           # JWT login, LDAP + local credentials
│   │   │   ├── tickets.py        # /api/tickets CRUD + /api/domains
│   │   │   ├── knowledge.py      # KB articles API
│   │   │   ├── admin.py          # classifier_domains CRUD
│   │   │   ├── admin_ops.py      # conversations list, approvals
│   │   │   ├── users.py          # RBAC user management
│   │   │   ├── settings.py       # integrations (confluence/jira/llm…)
│   │   │   ├── dashboard.py, conversations.py, health.py, domain_rename.py
│   │   ├── orchestration/orchestrator.py   # run_rag — linear fallback pipeline
│   │   ├── rag/              # retrieval.py, rewriter.py, gate.py,
│   │   │                     # reranker.py, bm25_index.py
│   │   ├── llm/client.py     # make_llm, stream_answer, _build_local_ollama
│   │   ├── knowledge/        # loaders.py, chunker.py, ingest.py
│   │   ├── classifier/engine.py   # domain classifier (DB-driven keywords)
│   │   ├── tools/ticket_tool.py   # agentic live-DB ticket lookup
│   │   ├── security/         # guardrails.py, api_keys.py, rate_limit.py
│   │   ├── auth/             # ldap_auth.py, rbac.py, deps.py
│   │   ├── persistence/      # database.py, models.py, redis.py
│   │   ├── integrations/     # confluence.py, jira.py, xwiki.py,
│   │   │                     # openproject.py, rerank_client.py, contacts.py
│   │   ├── observability/    # audit.py, metrics.py, telemetry.py
│   │   └── workers/          # (module lives at backend/workers/)
│   ├── workers/
│   │   ├── celery_app.py     # beat_schedule — sync-kb every 30 min
│   │   └── sync_tasks.py     # sync_kb task
│   ├── tests/                # pytest suite
│   ├── pyproject.toml        # uv-managed dependencies
│   └── docker-compose.dev.yml# local lab stack
├── frontend/                 # React 18 + Vite + Tauri 2 (TypeScript)
│   ├── src/
│   │   ├── App.tsx           # page router (hash-based)
│   │   ├── features/         # auth, chat, dashboard, knowledge, domains,
│   │   │                     # tickets, users, apikeys, conversations,
│   │   │                     # audits, settings (per-page modules)
│   │   ├── components/       # PageSidebar, NotificationBell, FloatingChat…
│   │   └── shared/api/client.ts  # apiFetch + authHeaders (single transport)
│   └── package.json
├── infra/k8s/                # RKE2 manifests (namespaced)
│   ├── 00-namespace.yaml
│   ├── postgres/             # CNPG cluster + pooler + pgAdmin
│   ├── redis/                # redis + sentinel HA
│   ├── ollama/               # Llama 3.2 1B + nomic-embed-text
│   ├── rerank-svc/           # bge-reranker-base HTTP service
│   ├── backend/  celery/  frontend/  ingress/
│   └── monitoring/           # (Grafana dashboards source)
└── docs/                     # architecture diagrams + this guide
```

## 0.2 Runtime Topology (Production — namespace `rag-chatbot`)

```
Users (Browser / Tauri Desktop)
        │  https://chat.drlinuxer.com (Ingress)
        ▼
frontend (nginx serve static) ──► backend FastAPI (x2, HPA)
        │                             │
        │ SSE /api/chat/stream        ├──► postgres-ha (CNPG 3 nodes) via
        │                             │      postgres-ha-pooler (PgBouncer)
        │                             ├──► redis (Sentinel HA) ── celery worker/beat
        │                             ├──► ollama (embed + llama3.2:1b fallback)
        │                             ├──► rerank-svc (bge-reranker)
        │                             └──► OpenRouter / H-Chat (primary LLM)
        │
confluence / xwiki / openproject ──(Celery beat 30m sync)──► ingest ──► pgvector
```

---

# M1 — Lab Setup (ကိုယ်ပိုင် စမ်းသပ်တည်ဆောက်ရေး ပတ်ဝန်းကျင်)

## 1.1 လိုအပ်သည့် Tools

| Tool | Version | ရည်ရွယ်ချက် |
|---|---|---|
| Python | 3.12 | backend + workers |
| **uv** | latest | dependency/venv management (`pyproject.toml`) |
| Node.js | 22 LTS | desktop build + tests |
| Docker Desktop | any | local postgres/redis containers |
| Git | any | repo |
| Ollama | any | local LLM + embedding (fallback lab) |

## 1.2 Backend Lab Setup

```bash
git clone <your-repo> rag-chatbot && cd rag-chatbot/backend

# venv + dependencies (uv ဖြင့်)
uv sync                      # pyproject.toml အတိုက် install

# Local infra (postgres + redis) — docker-compose.dev.yml ရှိပြီးသား
docker compose -f docker-compose.dev.yml up -d

# .env ဖန်တီး (config.py က SETTINGS အားလုံး env ဖတ်သည်)
cat > .env <<'ENV'
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/assistant
REDIS_URL=redis://localhost:6379/0
OPENAI_API_KEY=***          # OpenRouter/H-Chat key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
CHAT_MODEL=z-ai/glm-5.3-flash
EMBED_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://localhost:11434
FALLBACK_ENABLED=1
JWT_SECRET=***
ENV

# app boot — init_db က vector extension + tables အားလုံး auto-create
uvicorn app.main:app --reload --port 8000

# tests
uv run pytest -q
```

## 1.3 Desktop Lab Setup

```bash
cd ../desktop
npm install
npm run dev                  # vite dev server (login fallback: dev/dev)
npx tsc --noEmit             # type check
npm test                     # vitest (7 tests)
```

## 1.4 Local-only KB Lab

`load_fileshare()` သည် local directory (`kb_files/`) မှ `.md/.txt` files များကို read လုပ်သောကြောင့် Confluence မလိုဘဲ ingestion lab ဆ登录နိုင်သည်။ Manual article ကို API (`/api/knowledge/articles`) ဖြင့် တင်၍ test လုပ်ပါ။

---

# M2 — Backend FastAPI Core

## 2.1 `main.py` ၏ အဓိက တည်ဆောက်ပုံ

```python
@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()                # ① tables + vector extension
    setup_telemetry()        # ② OTel spans/metrics hooks
    # ③ reranker preload (local mode သာ; remote ဖြစ်ရင် skip)
    yield

app = FastAPI(title="IT Help Chatbot", version="0.2.0", lifespan=lifespan)
app.include_router(chat_router)        # 12 routers အစီအစဉ်တကျ mount
```

**သင်ယူရမည့် အချက်**
- **Lifespan pattern:** startup တွင် DB schema + telemetry init၊ shutdown မလိုလျှင် `yield` နောက်ကွယ် ဗလာထား။
- **Router-per-domain:** `api/` တွင် endpoint ဖိုင်များကို feature အလိုက်ခွဲ — `APIRouter(prefix="/api")`။
- **Config via `SETTINGS`:** `app/config.py` တွင် `pydantic-settings BaseSettings` class သုံးပြီး env/.env မှ type-safe ဖတ်သည်။ Runtime override အတွက် `/api/settings/integrations/llm` မှ DB-driven config (30s TTL cache) ထပ်ဆင့်။

## 2.2 FastAPI သင်ခန်းစာ (Minimal Skeleton — Lab)

```python
from fastapi import FastAPI, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()

class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None

def get_current_user(authorization: str = "") -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    return "alice"

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {__import__('json').dumps(data)}\n\n"

@app.post("/api/chat/stream")
def chat_stream(req: ChatRequest, user: str = Depends(get_current_user)):
    def gen():
        yield sse("stage", {"stage": "understanding"})
        for tok in ["Hello", " ", "world"]:
            yield sse("token", {"token": tok})
        yield sse("done", {"latency_ms": 42})
    return StreamingResponse(gen(), media_type="text/event-stream")
```

> ဒီ project ၏ `chat_stream` သည် အထက် pattern အတိုင်း SSE `stage / meta / token / caution / approval_request / done` events များကို စီစဉ်ပို့သည်။

---

# M3 — PostgreSQL + pgvector (Initial Setup)

## 3.1 CNPG High-Availability Cluster (K8s)

`infra/k8s/postgres/10-cluster.yaml` ၏ အကျဉ်းချုပ်:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: postgres-ha, namespace: rag-chatbot }
spec:
  instances: 3                     # 1 primary + 2 streaming standbys
  imageName: ghcr.io/cloudnative-pg/postgresql:16.4
  storage:
    size: 30Gi
    storageClass: truenas-iscsi
  bootstrap:
    initdb:
      database: assistant          # app database
```

**Pooler (PgBouncer) — Connection pooling:**

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata: { name: postgres-ha-pooler }
spec:
  cluster: { name: postgres-ha }
  instances: 2
  pgbouncer: { poolMode: transaction }   # backend max_connections=200 ကို ဖြေဆယ်
```

> ⚠️ **Lesson (ကျွန်တော်တို့ တွေ့ခဲ့ဖူးသည့် bug):** Pooler သည် **Deployment မဟုတ်ဘဲ `Pooler` CR** ဖြစ်ရမည် — CR ဖျက်မိပါက operator-managed SA/RBAC ပျက်ပြီး CrashLoop ဖြစ်တတ်သည်။

## 3.2 `init_db()` — Idempotent Schema Bootstrap

`app/persistence/database.py`:

```python
def init_db() -> None:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))  # pgvector
        conn.commit()
    Base.metadata.create_all(bind=engine)   # SQLAlchemy models → tables
```

**Core tables** (`app/persistence/models.py`): `chat_sessions`, `chat_messages`, `feedback`, `jira_tickets`, `ticket_comments`, `classifier_domains`, `api_keys`, `audit_log`, `users`, `approvals`, `system_settings`, `rbac_matrix` … + LangChain မှ auto-create လုပ်သော `langchain_pg_collection` / `langchain_pg_embedding`။

## 3.3 pgvector Index Strategy (Hybrid Search အတွက်)

```sql
-- Dense (semantic): HNSW cosine
CREATE INDEX langchain_pg_embedding_hnsw_idx
  ON langchain_pg_embedding
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Lexical (keyword): GIN on tsvector
CREATE INDEX langchain_pg_embedding_tsv_idx
  ON langchain_pg_embedding USING gin (tsv);
```

* `embedding vector(768)` — `nomic-embed-text` dimension နှင့် တွဲထား။
* Tuning: query session တိုင်း `SET hnsw.ef_search = 64` (accuracy/latency knob)။
* Production ops (VACUUM/ANALYZE/REINDEX) အတွက် → `docs/ops/postgres-pgvector-admin-guide.md` ကို ကြည့်ပါ။

---

# M4 — Redis + Celery (Async Jobs & Queue HA)

## 4.1 ဘာကြောင့် Redis လိုသလဲ

1. **Celery broker + result backend** — KB sync (Confluence/XWiki/OpenProject fetch) ကို background task အဖြစ် run။
2. **Rate limiting** — chat 5 req/min (`security/rate_limit.py` ၏ `@limit("chat")` decorator)။
3. **Cache** — hot settings / derived state။

## 4.2 Standalone vs Sentinel (Config-driven)

`app/persistence/redis.py`:

```python
# Standalone (default):
REDIS_URL=redis://redis-master:6379/0

# Sentinel HA:
REDIS_MODE=sentinel
REDIS_SENTINELS=redis-sentinel-0:26379,redis-sentinel-1:26379,redis-sentinel-2:26379
REDIS_MASTER_NAME=redis-master
# Celery broker → kombu: sentinel://h1:26379;alt=h2:26379;alt=h3:26379:6379/0
```

## 4.3 Celery Workers + Beat Scheduler

```python
# backend/workers/celery_app.py
celery_app.conf.beat_schedule = {
    "sync-kb": {"task": "workers.sync_tasks.sync_kb", "schedule": crontab(minute="*/30")},
}

# backend/workers/sync_tasks.py
@celery_app.task
def sync_kb():
    from app.knowledge.ingest import sync_all
    return sync_all(updated_by="celery-beat")
```

**K8s deployment အားလုံး (Docker image တူ၊ command ကွာ):**

| Deployment | Command |
|---|---|
| `backend` | `uvicorn app.main:app` |
| `celery-worker` | `celery -A workers.celery_app worker` |
| `celery-beat` | `celery -A workers.celery_app beat` |

> ⚠️ **Lesson:** backend image bump တိုင်း worker/beat ကို **အတူတကွ** redeploy လုပ်ရမည် (code တစ်ပုံတည်း)။

---

# M5 — KB Ingestion & Load Generator

## 5.1 Data Flow

```
Confluence REST      XWiki REST       OpenProject wiki      kb_files/ (local)      Manual API
     │                   │                    │                    │                    │
     └─────────┬─────────┴─────────┬──────────┴────────────────────┴────────────────────┘
               ▼                   ▼
  loaders.py — load_all()  →  [{page_id, title, domain, source_url, body}, …]
               ▼
  chunker.py — chunk_text()  →  ["Cisco Guide — Firmware. 1. Backup…", …]
               ▼
  ingest.py — ingest_article() per article:
       content_hash(title+body) → unchanged? skip (delta sync)
       → _delete_vectors(page_id) → PGVector.add_documents (embed via Ollama)
       → _upsert_meta(kb_meta)  [+ BM25 index invalidate()]
               ▼
  langchain_pg_embedding (vector 768 + tsv)  ←── RAG queries read this
```

## 5.2 Loader Contract ("Load Generator")

 loaders များ၏ ပြန်ပေးသော dict shape — **uniform contract**:

```python
{
  "page_id":    "conf-IT-1234",     # stable unique id (source-namespaced)
  "title":      "VPN Troubleshooting",
  "domain":     "network",          # classifier_domains key (optional)
  "source_url": "https://confluence…/pages/…",
  "body":       "## Prerequisites\n…",  # markdown
}
```

* `load_confluence()` — `SETTINGS.confluence_space_keys` comma-list အလိုက် space များ fetch
* `load_all()` — confluence + openproject wiki + xwiki + fileshare + manual articles ပေါင်းစု
* `sync_all()` — full diff-sync (30-min beat)။ Manual KB API edit တွင်လည်း invalidate

## 5.3 Chunking Method (Section-Header Aware)

`chunker.py` — 3 rules:
1. **Markdown headers (`## / ###`) နယ်နိမိတ်အလိုက်** section ခွဲ
2. ရှည်လျှားလျှင် **800-word sliding window + 10% overlap** (`step = int(800 * 0.9)`)
3. **Chunk တိုင်း၏ အစတွင် `"{Page Title} — {Section Header}. "` prefix တပ်** → naked-fragment problem ကို ပြေလည်စေ (short-query recall +35%)

> Diagram: `docs/architecture/rag-chunking-strategy.html`

---

# M6 — RAG Pipeline: 6 Core Stages (အဓိက Module)

```
User "hi" ─► ① Guardrails ─► ② Classify+Rewrite ─► ③ Hybrid Retrieve
                                                           │
             ⑥ LLM Stream ◄─ ⑤ Prompt ◄─ ④ Rerank+Gate ◄───┘
```

### Stage ① — Input Guardrails (`security/guardrails.py`)
* Deterministic regex screening **before any LLM/DB cost**: prompt-injection probe / overflow (>4k) / toxic abuse
* `blocked` → immediate SSE `caution`; `flagged` → instant canned refusal (107s → 1.9s lesson)

### Stage ② — Classify + Rewrite (`classifier/engine.py`, `rag/rewriter.py`)
* Domain classifier = DB `classifier_domains.keywords` (knowledge manager ထည့်သည့် domain ချက်ချင်း အသုံးဝင်)
* Rewrite: noise strip + follow-up pronoun resolution (ယခင် turn က subject ကို ဆက်ကူး)

### Stage ③ — Hybrid Retrieval (`rag/retrieval.py`)
* **Branch A:** pgvector HNSW cosine (ANN)
* **Branch B:** Two-tier lexical — in-memory **BM25Okapi** (`rank_bm25`, <1.5ms) primary + Postgres `tsvector` GIN fallback
* **RRF fusion:** `score = Σ 1/(60 + rank)` → cross-encoder candidates
* top_k precedence: per-call arg → `runtime_kv` (Settings UI hot knob) → `SETTINGS`

### Stage ④ — Rerank + Confidence Gate (`rag/reranker.py`, `rag/gate.py`)
* `BAAI/bge-reranker-base` cross-encoder — remote `rerank-svc:8080`
* Heuristics: title-overlap boost `min(0.15×overlap, 0.45)`; generic hub pages penalized −0.1
* Gate: sigmoid(top score) **≥ 0.75 → answer**; < 0.75 → caution (anti-hallucination)
* Fail-safe: rerank ပျက်လျှင် vector order သို့ graceful degrade

### Stage ⑤ — Prompt Assembly (`llm/client.py::_SYSTEM_PROMPT`)
* KB = **DATA, never instructions** (injection-resistant framing)
* Markdown-table rule, completeness rule, same-language rule, rejection rule

### Stage ⑥ — LLM Generation + Dual Failover
* Primary: OpenRouter/H-Chat (`ChatOpenAI`, timeout 15s)
* Fallback: on-prem `llama3.2:1b` (context truncated to 4k, `num_predict=256`)
* Token streaming via SSE; usage captured on final sentinel

> Diagrams: `docs/architecture/rag-pipeline-6-stages.html`, `hybrid-search-bm25-pgvector.html`, `rag-reranker-architecture.html`

---

# M7 — LangGraph Orchestration (`graph_rag.py`)

## 7.1 Graph Topology (Compiled StateGraph)

```python
g.set_entry_point("classify")
classify → rewrite → retrieve → gate ─┬─ (retry) → rewrite
                                      └─ → context → tools ─┬─ answer → END
                                                            └─ escalate → approval ⏸
approval ─┬─ ticket → create_ticket → END
          └─ rejected → END
```

* **Nodes** = pure functions over `RAGState` TypedDict (domain/rewritten/docs/confidence/decision/context…)
* **`interrupt()` HITL:** `_node_approval` တွင် graph ရပ်တန့်ပြီး `approvals` row ဖန်တီး၊ SSE `approval_request` ပို့ → admin decide လျှင် `Command(resume=...)` ဖြင့် resume
* **Postgres checkpointer** (`langgraph-checkpoint-postgres`) — pause state ကို replica 25 လုံးကြား share လုပ်နိုင် (MemorySaver သို့ auto-degrade)
* `LANGGRAPH_ENABLED=1` env — ပျက်လျှင် `orchestrator.run_rag()` linear path သို့ fallback

## 7.2 Agentic Tool Node

`tools/ticket_tool.py`: detect_ticket_intent(query) → RBAC-scoped live SQL → context prepend + confidence forced 0.95 + KB sources dropped (table-only answer)။

---

# M8 — LLM Provider Layer (`llm/client.py`)

**Config precedence:** DB `system_settings['llm']` (Settings UI) → env `SETTINGS`

```python
make_llm():
    provider = db or env → ChatOpenAI(base_url=openrouter, model=…, timeout=15.0, max_retries=1)
stream_answer(question, context):
    try:  yield from primary stream (with usage sentinel)
    except ProviderError:
        if SETTINGS.fallback_enabled:
            fb = _build_local_ollama()   # ChatOllama llama3.2:1b + context 4k cap
            yield from fb.stream(...)    # logged fallback + DB-backed metrics
```

**Lessons:** provider error မခံနိုင်ရင် fallback ကို **streaming မှတိုက်ရိုက် catch** ရမည်; CPU local model သုံးရင် context truncate မဖြစ်မနေ လိုအပ် (26s first-token lesson)။

---

# M9 — Security Layer

| အစိတ်အပိုင်း | ဖိုင် | လုပ်ဆောင်ချက် |
|---|---|---|
| **JWT Auth** | `auth/ldap_auth.py` | LDAP bind + `local_user_credentials` fallback; `/api/auth/me` |
| **RBAC** | `auth/rbac.py` | roles (admin/agent/knowledge/user) + capability matrix (`rbac_matrix`) + per-user overrides + allowed_domains |
| **API Keys** | `security/api_keys.py` | `ith_…` keys, SHA-256 hash-only storage, show-once, revoke→purge lifecycle |
| **Guardrails** | `security/guardrails.py` | injection/toxic/overflow deterministic screens |
| **Rate limit** | `security/rate_limit.py` | Redis-backed `@limit("chat")` = 5 req/min → 429 |
| **Audit** | `observability/audit.py` | `audit_log` append-only (DB source-of-truth for security totals) |

---

# M10 — Desktop App (React + Vite + Tauri)

## 10.1 Stack

* **React 18 + TypeScript + Vite** build; **Tailwind CSS v4** + Radix UI primitives; **lucide-react** icons; **framer-motion** animation; **react-markdown + remark-gfm + shiki** (answer rendering)
* **Tauri 2** (`@tauri-apps/api`) — desktop shell wrapper (same web build)
* State: hooks only — **no localStorage business data** (all prefs in server DB; `ith.dark` theme mirror က boot-flash prevent ရန် သီးသန့်)

## 10.2 Feature-based Structure (per-page vertical slices)

```
src/features/<domain>/
├── api.ts          # fetch wrappers for that page's endpoints
└── pages/XPage.tsx # UI (props: role, userName, onToast, onNavigate)
```
Active pages: chat, dashboard, knowledge(articles), domains, tickets, users, apikeys, conversations(history), audits, settings + auth(Login)။ Routing: `App.tsx` switch on hash route; shell = `PageShell` + `PageSidebar` (capability-filtered)။

## 10.3 New Desktop App ကို သုညမှ ဖန်တီးနည်း (Lab)

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm i -D tailwindcss @tailwindcss/vite
npm i react-markdown remark-gfm lucide-react clsx tailwind-merge
# src/shared/api/client.ts — single transport with auth header + 401 handling
```

**Core module — API client (`shared/api/client.ts`):**

```ts
export const BASE = import.meta.env.PROD ? "" : "http://localhost:8000";
export const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

export async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, { ...init, headers: { ...(init?.headers||{}), ...authHeaders() } });
  if (r.status === 401) { clearSession(); location.hash = "#/login"; }
  return r;
}
```

**Core module — SSE client (`useChatStream.ts` skeleton):**

```ts
const res = await fetch(`${BASE}/api/chat/stream`, {
  method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
  body: JSON.stringify({ message, session_id }),
});
const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
for (;;) {
  const { value, done } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const parts = buf.split("\n\n"); buf = parts.pop() ?? "";
  for (const block of parts) {
    const ev = /event: (\w+)/.exec(block)?.[1];
    const data = JSON.parse(/data: (.*)/.exec(block)![1]);
    if (ev === "stage") onStage(data);
    if (ev === "token") onToken(data.token);      // append to streaming bubble
    if (ev === "meta")  onMeta(data);             // sources, confidence, decision
    if (ev === "caution") onCaution(data);        // guardrail / low-confidence notice
    if (ev === "done")  onDone(data);             // message_id, usage, latency
  }
}
```

**Chat UX conventions (project standard):** user bubble အောက် always-visible ✏️ edit(in-place)/📋 copy/🔄 retry; long-word overflow guards (`break-words [overflow-wrap:anywhere]`); citations cards from `meta.hits`။

---

# M11 — Observability, Build & Deploy

## 11.1 Metrics & Traces
* `observability/metrics.py` — prometheus_client: `chat_requests_total`, `chat_latency_seconds` (histogram), `guardrail_events_total`, DB-backed `security_events_db_total` gauge (audit_log source-of-truth — HPA churn fix lesson: read with `max()` not `sum()`)
* `telemetry.py` — OTel spans (`chat.request`, `rag.cross_encoder_rerank`…) → Alloy → Tempo service graph

## 11.2 Build & Deploy Pipeline

```bash
# Backend
cd backend && docker build -t harbor.drlinuxer.com/rag-chatbot/backend:<ver> .
docker push harbor.drlinuxer.com/rag-chatbot/backend:<ver>

# Desktop
cd desktop && npm run build && docker build -t harbor.drlinuxer.com/rag-chatbot/frontend:<ver> .
docker push …

# K8s — digest-pinned rollout (backend+workers+beat together)
kubectl -n rag-chatbot set image deploy/backend  backend=<image>@sha256:<digest>
kubectl -n rag-chatbot set image deploy/celery-worker celery-worker=<backend:image>
kubectl -n rag-chatbot set image deploy/celery-beat  celery-beat=<backend:image>
kubectl -n rag-chatbot set image deploy/frontend frontend=<image>@sha256:<digest>
kubectl -n rag-chatbot rollout status deploy/backend

# LIVE verify (never claim done from local build)
curl -sk https://chat.drlinuxer.com/health
```

---

# ✅ Verification Checklist (Course Completion)

| # | Check | Expected |
|---|---|---|
| 1 | `uvicorn app.main:app` boots | `/health` 200; `init_db` created tables |
| 2 | Manual article → `/api/knowledge/articles` | chunked 800/10%, rows in `langchain_pg_embedding` |
| 3 | Query "hi" | SSE stage→meta(caution-ish)→token→done |
| 4 | kill OpenRouter key | fallback answers via `llama3.2:1b` |
| 5 | `hnsw` used? | `EXPLAIN ANALYZE` shows Index Scan using hnsw_idx |
| 6 | Desktop `npm test` + `tsc --noEmit` | 7/7 + clean |
| 7 | Create ticket from chat dialog | 201, category = live domain label |

# ⚠️ Gotchas (မမေ့သင့်သည်များ)

1. **Pooler must be a CNPG `Pooler` CR** — hand-made Deployment/SA ရှောင်ပါ။
2. **SSE generator exception မထုတ်ရ** — pipeline failure တိုင်း degrade path (fallback/linear/caution) ရှိရမည်။
3. **`increase()` over pod churn** = phantom counts — lifetime totals ကို DB audit မှ gauge အဖြစ် တင်ပြီး `max()` ဖြင့် read။
4. **Schema drift** — frontend payload field names (`subject`) နှင့် pydantic model (`summary`) ကို alias/tolerant model ဖြင့် lock ထား။
5. **API key show-once:** raw value ကို UI တွင် copy ဝင်သည်နှင့် မပြတော့အောင် enforce (client-side) + hash-only storage (server-side)။
6. **Celery worker/beat = same image** as backend — version co-bump မမေ့ပါ။
7. **Local fallback context cap** (~4k chars) — CPU model ကို 2.2k+ token prompt မတင်ပါနဲ့ (first-token 26s)။

# 📖 Glossary (မြန်မာ ↔ English)

| English | မြန်မာ |
|---|---|
| Retrieval-Augmented Generation (RAG) | အချက်အလက်ရှာဖွေမှုပါ LLM ဖြေဆိုစနစ် |
| Chunking | စာပိုဒ်ခွဲခြင်း |
| Embedding | စာသား→ဂဏန်းဗတ္တိအဖြစ် ပြောင်းခြင်း |
| Hybrid search | Vector + Keyword ပေါင်းရှာခြင်း |
| Reciprocal Rank Fusion (RRF) | ရာထူးစုစည်းပေါင်းစပ်နည်း |
| Reranker | တိကျမှုပြန်စစ် အဆင့်သတ်မှတ်ခြင်း |
| Confidence gate | ယုံကြည်မှုတံခါး (0.75 threshold) |
| Failover / Fallback | အရန်စနစ်သို့ပြောင်းခြင်း |
| Rate limiting | တောင်းဆိုနှုန်းကန့်သတ်ခြင်း |
| High availability (HA) | အဆက်မပြတ်လည်ပတ်ရေးစနစ် |
