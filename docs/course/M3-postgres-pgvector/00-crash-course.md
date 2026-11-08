# M3 — PostgreSQL + pgvector Crash Course (အခြေခံမှ စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — SQL / PostgreSQL ဘာမှ မသိသေးသူများအတွက် — ဒီ project ရဲ့
> pgvector hybrid search ကို နားလည်စေဖို့ **Essential** အခြေခံများကို မြန်မာလို အသေးစိတ် သင်ကြားထားခြင်း။
>
> **မဖတ်ခင် လိုအပ်ချက်** — M2 FastAPI Crash Course ပြီးသင့်သည် (pooler, schema စသည့် အသုံးအနှုန်း များ နားလည်ပြီးသား ဖြစ်ရန်)

---

## 📚 Lesson များ

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | PostgreSQL အခြေခံ — Table, Row, Index | 🟢 |
| **L2** | Embedding/Vector ဆိုတာ ဘာလဲ | 🟢 |
| **L3** | pgvector operators + မှတ်စုများ | 🟢 |
| **L4** | Index — B-tree vs GIN vs HNSW | 🟡 |
| **L5** | Hybrid Search + RRF | 🟡 |
| **L6** | CNPG (K8s Postgres HA) + PgBouncer | 🔴 |

---

# Lesson 1 — PostgreSQL အခြေခံ

## သီအိုရီ

PostgreSQL က **relational database** — data ကို **table** ထဲ **row/column** ပုံစံနဲ့ သိမ်းသည်။
SQL query နဲ့ ရှာ/ထည့်/ပြင်/ဖျက် လုပ်သည်။

```sql
-- Table ဖန်တီး
CREATE TABLE tickets (
    id SERIAL PRIMARY KEY,          -- auto-increment id
    subject TEXT NOT NULL,          -- မဖြစ်မနေရ
    status TEXT DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row ထည့်
INSERT INTO tickets (subject) VALUES ('VPN broken');

-- Row ရှာ
SELECT * FROM tickets WHERE status = 'open';

-- Row ပြင်
UPDATE tickets SET status = 'resolved' WHERE id = 5;

-- Row ဖျက်
DELETE FROM tickets WHERE id = 5;
```

**ဒီ project မှာ tables ၁၂ ခုကျော် ရှိသည်** — `chat_sessions`, `chat_messages`,
`jira_tickets`, `api_keys`, `users`, `audit_log`, `classifier_domains` ...

## Index ဆိုတာ ဘာလဲ

Index မရှိရင် query က **table တစ်ခုလုံးကို တစ်ကြိမ်လုံး ဖတ်ရမယ်** (Sequential Scan)။
မှတ်စုစာအုပ်ထဲ တစ်စာမျက်နှာ ရှာတဲ့အခါ စာအုပ်စာမျက်နှာအားလုံး လှန်ရသလိုပါပဲ။

```sql
-- 1000 rows ရှိတဲ့ table မှာ ရှာရင်
SELECT * FROM tickets WHERE status = 'open';
-- Index မရှိ: 1000 rows အကုန် စစ်
-- Index ရှိ: status value တွေ ကို sorted tree ထဲ ရှာ (~10 steps)
```

---

# Lesson 2 — pgvector ဆိုတာ

## ရှင်းလင်းချက်

AI မှာ စာသားတစ်ပါဒါကို **ဂဏန်း array (vector)** အဖြစ် ပြောင်းလို့ရသည် —
ဥပမာ `"How do I reset VPN"` ကို 768 ဂဏန်းတို့ရဲ့ list တစ်ခုအဖြစ် ပြောင်းမယ်။

**နှစ်စာသား တူညီမှုကို တိုင်းရန်** — vector နှစ်ခုရဲ့ **angle** ကို တိုင်းသည်:
- Angle သေး (close) → စာသား ၂ ခု ဆင်တူ (similar)
- Angle ကျယ် (far) → မဆင်တူ

**pgvector** က PostgreSQL ထဲမှာ vector type + နှိုင်းယှဉ် operators ထည့်ပေးသည်။

```sql
-- Extension install (once)
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector column တစ်ခုနဲ့ table ဖန်တီး
CREATE TABLE docs (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(768)    -- 768 = nomic-embed-text model dimension
);
```

**⚠️ `vector(768)` က ဘာလဲ?**
- 768 က embedding model ရဲ့ dimension — `nomic-embed-text` က output 768 float
- မဟုတ်ရင် insert/index မှာ ချက်ချင်း error ရမယ် (model ပြောင်းရင် dimension ပါ ပြောင်းရမယ်)

---

# Lesson 3 — pgvector Operators

## Operators

```sql
-- Cosine distance (ဒီ project သုံးထားတဲ့ဟာ) — 0 (same) to 2 (opposite)
embedding <=> query_vector

-- L2 distance (Euclidean)
embedding <-> query_vector

-- Negative inner product
embedding <#> query_vector
```

**Cosine similarity vs distance:**
```sql
-- pgvector က DISTANCE ပြန်ပေးသည် (1.0 = လုံးဝမတူ၊ 0.0 = တူညီ)
-- CONFIDENCE လိုချင်ရင် 1 ကို ပြန်နုတ်ပါ
SELECT 1 - (embedding <=> query_vector) AS similarity
FROM docs;
```

## 🔧 Lab 3.1 — pgvector Local Lab

```bash
# Start local postgres
docker compose -f docker-compose.dev.yml up -d
docker exec -it backend-postgres-1 psql -U postgres -d assistant

-- Extension install လုပ်
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname FROM pg_extension;  -- 'vector' ရှိမယ်

-- Test table
CREATE TABLE test_vec (
    id SERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(768)
);

-- Dummy vectors 10 ခု ထည့်
INSERT INTO test_vec (content, embedding)
SELECT
  'doc ' || i,
  ('[' || array_to_string(
    ARRAY(SELECT round(random()::numeric, 4) FROM generate_series(1, 768)),
    ','
  ) || ']')::vector
FROM generate_series(1, 10) i;

-- Cosine query
SELECT content, 1 - (embedding <=> (SELECT embedding FROM test_vec LIMIT 1)) AS sim
FROM test_vec
ORDER BY embedding <=> (SELECT embedding FROM test_vec LIMIT 1)
LIMIT 3;
```

---

# Lesson 4 — Index Types (မှန်ကန်တဲ့ Index ရွေးချယ်ရန်)

| Index Type | ဘာအတွက် | ဘယ်နေရာမှာ သုံး |
|---|---|---|
| **B-tree** | exact match / range (integer, date) | `WHERE id = 5`, `created_at > ...` |
| **GIN** | arrays, JSONB, full-text search | `metadata`, `tsv` columns |
| **HNSW** | **vectors** (approximate nearest neighbor) | `embedding` column |

## HNSW Parameters

```sql
CREATE INDEX idx ON docs
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Query လုပ်ချိန် tuning
SET hnsw.ef_search = 64;
```

**Parameters ရှင်းလင်းချက်:**
- `m = 16` — graph node တစ်ခုချင်းစီရဲ့ connections
- `ef_construction = 64` — build လုပ်ချိန် ဘယ်လောက် deep ရှာမယ်
- `ef_search = 64` — query လုပ်ချိန် ဘယ်လောက် deep ရှာမယ် (accuracy vs speed)

## 🔧 Lab 3.2 — Index Verify (Production)

```bash
kubectl -n rag-chatbot exec deploy/backend -- python -c "
from app.persistence.database import engine
from sqlalchemy import text
with engine.connect() as c:
    rows = c.execute(text(\"\"\"
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'langchain_pg_embedding'
    \"\"\"))
    for r in rows: print(r.indexname)
"
# Expect: hnsw_idx + tsv_idx
```

## 🔧 Lab 3.3 — EXPLAIN ANALYZE

```sql
-- Index သုံးနေလား စစ်ဆေးမယ်
EXPLAIN ANALYZE
SELECT id FROM langchain_pg_embedding
ORDER BY embedding <=> (SELECT embedding FROM langchain_pg_embedding LIMIT 1)
LIMIT 5;

-- "Index Scan using ...hnsw_idx" → OK
-- "Seq Scan" → index မသုံးဘူး (setup စစ်)
```

---

# Lesson 5 — Hybrid Search + RRF

## ရှင်းလင်းချက်

**Branch A (Vector)** — semantic meaning နားလည် ("how to fix VPN" = "VPN repair guide")
**Branch B (FTS/BM25)** — exact keyword (acronym, error code, product name)

```sql
-- Branch A — vector
SELECT id, title, 1 - (embedding <=> CAST(:qemb AS vector)) AS score
FROM langchain_pg_embedding
ORDER BY embedding <=> CAST(:qemb AS vector) LIMIT 8;

-- Branch B — FTS
SELECT id, title, ts_rank(fts, to_tsquery('english', 'vpn AND reconnect')) AS score
FROM langchain_pg_embedding
WHERE fts @@ to_tsquery('english', 'vpn AND reconnect')
LIMIT 8;
```

## RRF Fusion Formula

```python
# rank 1-based ဖြစ်ရမည်
score = Σ (1 / (k + rank))   # k = 60
```

**ဥပမာ:**
```text
Doc A: vector rank 1, FTS rank 3
  → RRF = 1/(60+1) + 1/(60+3) = 0.0164 + 0.0159 = 0.0323

Doc B: vector rank 5, FTS rank 2
  → RRF = 1/(60+1) + 1/(60+2) = 0.0164 + 0.0161 = 0.0325

Doc B က အနည်းငယ် အမြင့် (နှစ် branch စလုံးမှာ high rank)
```

**ဘာလို့ `k = 60`?** — rank ၁ vs rank ၂ ရဲ့ ကွာခြားချက် မကြီးလွန်းစေရန်
(smoothing constant)။ k က low ဖြစ်လျှင် top rank များ အလွန် မြင့်မယ်၊ high ဖြစ်ရင် flat မယ်။

## ⚠️ pgvector Gotchas

```python
# ❌ Python list ကို တိုက်ရိုက် bind လုပ်ရင် double precision[] ဖြစ်သွားမယ်
# SQLAlchemy text() with :emb → "operator missing" error

# ✅ CAST သုံးပါ
sql = text("SELECT 1 - (embedding <=> CAST(:emb AS vector)) FROM docs")
conn.execute(sql, {"emb": "[0.1, 0.2, ...]"})
```

---

# Lesson 6 — CNPG (CloudNative-PG)

## ရှင်းလင်းချက်

CNPG က **Kubernetes အတွက် Postgres operator** — PostgreSQL cluster များကို
manifest ဖြင့် manage လုပ်နိုင်သည် (HNSW index, replication, backup, failover)။

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: postgres-ha }
spec:
  instances: 3            # 1 primary + 2 replicas
  storage: { size: 30Gi, storageClass: truenas-iscsi }
  bootstrap:
    initdb: { database: assistant }
---
# Pooler — connection pooling
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata: { name: postgres-ha-pooler }
spec:
  cluster: { name: postgres-ha }
  instances: 2
  pgbouncer: { poolMode: transaction }
```

**Live verify:**
```bash
kubectl -n rag-chatbot get pods | grep postgres
# postgres-ha-1  (replica)
# postgres-ha-2  (primary)
kubectl -n rag-chatbot exec postgres-ha-2 -- psql -c "SELECT pg_is_in_recovery()"
# → f (primary)

# Replication status
kubectl -n rag-chatbot exec postgres-ha-2 -- psql -c "SELECT * FROM pg_stat_replication"
```

---

# ✅ Self-Check (M3)

1. `<=>` နဲ့ `<->` ကွာပုံက ဘာလဲ? ဘာလို့ cosine ကို ရွေးထားလဲ?
2. HNSW က IVFFlat ထက် ဘာကောင်းလဲ? (recall vs build speed)
3. RRF formula မှာ `k = 60` က ဘာလို့ လိုသလဲ?
4. `vector(768)` — 768 က ဘာနဲ့ ဆက်စပ်နေလဲ?
5. Python ကနေ pgvector query ရေးတဲ့အခါ **CAST(... AS vector)** ဘာလို့ လိုသလဲ?
6. CNPG မှာ `Pooler` ကို hand-made Deployment အစား CR နဲ့ လုပ်ရတဲ့ အကြောင်းရင်း ဘာလဲ?

---

> **နောက်တစ်ဆင့်** — M4 (Redis + Celery) folder ကို ဆက်လေ့လာပါ။
> **ဆက်စပ်ဖတ်ရန်** — `PGVECTOR_STUDY_GUIDE.md` (C:\Users\aungaung\onprem-ai-assistant\docs\ ထဲမှာ အပြည့်အစုံ ရှိသည်)