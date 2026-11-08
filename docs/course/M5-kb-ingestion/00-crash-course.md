# M5 — KB Ingestion Crash Course (အပြည့်အစုံ)

> `M5-kb-ingestion/00-crash-course.md`

## L1 — Ingestion Pipeline အပြည့်အစုံ

```
Confluence / XWiki / OpenProject / kb_files/ / Manual API
    │
    ▼ ① LOAD (loaders.py) — uniform contract
[{"page_id", "title", "domain", "body", "source_url"}, ...]
    │
    ▼ ② CHUNK (chunker.py) — section-aware + 800tok + 10% overlap
    │
    ▼ ③ EMBED (embeddings.py — Ollama nomic-embed-text 768-dim)
    │
    ▼ ④ UPSERT (ingest.py — content_hash delta + pgvector idempotent)
    │
    └─ langchain_pg_embedding (vector + tsv)
```

## L2 — Section-Aware Chunking

```python
def chunk_text(text, chunk_tokens=800, overlap=0.10):
    # 1. Markdown headers နယ်နိမိတ်အလိုက် ခွဲ
    sections = split_by_headers(text)
    chunks = []
    for section in sections:
        # 2. Sliding window + overlap
        if word_count(section) > 800:
            step = int(800 * 0.9)
            chunks.extend(sliding_window(section, 800, step))
        else:
            chunks.append(section)
    # 3. Title + section prefix — naked fragment fix
    return [f"{title} — {header}. {c}" for c in chunks]
```

**ဘာလို့ prefix?** — Chunk ထဲ "Step 3. Run this..." ပဲရှိရင် ဘယ် runbook လဲ မသိဘူး —
prefix နဲ့ 35% short-query recall တက်သည်။

## L3 — Delta Sync (Change Detection)

```python
new_hash = md5(title + body)
if existing.content_hash == new_hash:
    return "skipped"     # 60k chunks re-embed မလုပ်ရ — 8 hours ကုန်မယ်
# changed → old vectors delete + re-embed
```

## 🔧 Lab M5 — Ingestion Test

```bash
# 1. Manual article POST
curl -X POST .../api/knowledge/articles \
  -d '{"title":"SSL Renewal","body":"certbot renew --dry-run"}'

# 2. Chunk count check
kubectl -n rag-chatbot exec deploy/backend -- python -c "
from app.persistence.database import engine
from sqlalchemy import text
with engine.connect() as c:
    print(c.execute(text('SELECT COUNT(*) FROM langchain_pg_embedding')).scalar())
"

# 3. Re-sync → "skipped" (delta sync works!)
```

## ✅ Self-Check M5

1. 60k chunks re-embed လုပ်ရင် ဘာကြာမလဲ?
2. Overlap က ဘာကာကွယ်လဲ?
3. Loader contract က ဘာလို့ uniform ဖြစ်ရမလဲ?

---