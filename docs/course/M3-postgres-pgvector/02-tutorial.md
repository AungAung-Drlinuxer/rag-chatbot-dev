## 🔧 Tutorial 3.1 — Local Postgres Lab

```bash
# docker-compose.dev.yml မှာ postgres + pgvector ရှိပြီးသား
docker compose -f docker-compose.dev.yml up -d

# psql shell ဝင်
docker exec -it backend-postgres-1 psql -U postgres -d assistant

-- pgvector extension install
CREATE EXTENSION IF NOT EXISTS vector;
SELECT extname FROM pg_extension;   -- 'vector' ပါလာကြည့်

-- စမ်းသပ် table ဖန်တီး
CREATE TABLE test_vec (
  id SERIAL PRIMARY KEY,
  content TEXT,
  embedding vector(768)
);

-- dummy vector ထည့် (random 768 values)
INSERT INTO test_vec (content, embedding)
SELECT
  'doc ' || i,
  ('[' || string_agg(round(random()::numeric, 4)::text, ',' ORDER BY g) || ']')::vector
FROM generate_series(1, 768) g, generate_series(1, 10) i
GROUP BY i;

-- HNSW index create
CREATE INDEX test_vec_hnsw_idx ON test_vec
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Query လုပ်ကြည့်
SET hnsw.ef_search = 64;
SELECT content, 1 - (embedding <=> (SELECT embedding FROM test_vec LIMIT 1)) AS sim
FROM test_vec ORDER BY embedding <=> (SELECT embedding FROM test_vec LIMIT 1) LIMIT 3;
```

## 🔧 Tutorial 3.2 — Real cluster မှာ Index စစ်

```bash
# Production database မှာ HNSW index သုံးနေလား စစ်
kubectl -n rag-chatbot exec deploy/backend -- python -c "
from app.persistence.database import engine
from sqlalchemy import text
with engine.connect() as c:
    r = c.execute(text(\"\"\"
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'langchain_pg_embedding'
    \"\"\"))
    for row in r: print(row.indexname, '|', row.indexdef[:100])
"
```

**မျှော်မှန် output:** `hnsw_idx` (vector_cosine_ops) နဲ့ `tsv_idx` (GIN) နှစ်ခုလုံး မြင်ရမယ်။

## 🔧 Tutorial 3.3 — EXPLAIN ANALYZE (Index သုံးမသုံး စစ်)

```sql
-- HNSW index သုံးနေလား စစ်ဆေးမယ်
EXPLAIN ANALYZE
SELECT id, content FROM langchain_pg_embedding
ORDER BY embedding <=> (SELECT embedding FROM langchain_pg_embedding LIMIT 1)
LIMIT 5;

-- မျှော်မှန် output: "Index Scan using langchain_pg_embedding_hnsw_idx"
-- ဒါမှမဟုတ် "Seq Scan" ဆိုရင် index မသုံးဘူး (query plan ကြည့်ပါ)
```

## ⚠️ pgvector Gotchas

```sql
-- ❌ မှားသည်: Python list ကိုတိုက်ရိုက် bind လုပ်ရင် double precision[] ဖြစ်သွားမယ်
SELECT 1 - (embedding <=> :emb) ...   # text :emb → operator missing error

-- ✅ မှန်စေရန်
SELECT 1 - (embedding <=> CAST(:emb AS vector)) ...
```

