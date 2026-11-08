# M5 — KB Ingestion & Load Generator

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Data Flow (Confluence → pgvector အထိ)

```
Confluence REST / XWiki / OpenProject / kb_files/ / Manual API
    └── loaders.py: load_all() → [{page_id, title, domain, body}, ...]
        └── chunker.py: chunk_text() → ["chunk 1", "chunk 2", ...]
            └── ingest.py: ingest_article()
                ├── content_hash (title+body) → unchanged? skip (delta sync)
                ├── _delete_vectors(page_id) → old chunks remove
                ├── PGVector.add_documents() → embed via Ollama
                └── _upsert_meta() → kb_meta row upsert
                    └── BM25 index invalidate()
                    ↓
        langchain_pg_embedding table (vector 768 + tsvector)
```

### Loader Contract (_uniform dict shape_)

```python
{
  "page_id":    "conf-IT-1234",       # source-namespaced unique id
  "title":      "VPN Troubleshooting",
  "domain":     "network",            # classifier_domains key
  "source_url": "https://confluence.../pages/123",
  "body":       "## Prerequisites\n...markdown..."
}
```

**ဘာလို့ uniform contract?** — Loader အသစ် ထပ်ထည့်ရင် (ဥပမာ — Notion, SharePoint)
အဲဒီ dict shape နဲ့ပဲ ပြန်ပေးရင် — `ingest.py` **မပြင်ရဘူး** အလိုအလျောက် အလုပ်လုပ်မယ်။

### Chunking Strategy (Section-Header Aware)

ဒီ project မှာ ၃ ဆင့် chunking logic —

1. **Markdown headers (`## / ###`) နယ်နိမိတ်** — natural semantic boundary
2. **Sliding window + overlap** — 800 words / 10% overlap
   (`step = int(800 * 0.9) = 720` → chunk ၁ ခုနဲ့ ၁ ခု 80 words ထပ်နေမယ်)
3. **Title + Section header prefix** — တိုင်း chunk ရဲ့ အစမှာ
   `"{Page Title} — {Section Header}. "` ထည့် —
   **naked-fragment problem** (chunk ထဲ ခေါင်းစဉ် မပါလို့ ဘယ် context လဲမသိ) ကို ဖြေရှင်း။

**ဘာလို့ overlap လိုလဲ?** — Boundary မှာ sentence တစ်ဝက် ကျနေရင် —
**semantic meaning ပျက်သွားမယ်**။ Overlap က ဒါကို ကာကွယ်ပေးသည်။

### Delta Sync (Change Detection)

```python
# content_hash ကို နှိုင်းယှဉ်ပြီး မပြောင်းလျှင် skip
new_hash = md5(title + body)
if existing.content_hash == new_hash:
    return "skipped"          # embed cost မကုန်ရ
# changed → old vectors delete + new embed
```

**ဘာလို့ အရေးကြီးလဲ?** — 60k chunks ရှိတယ်ဆိုရင် 30-min sync တိုင်း re-embed လုပ်ရင်
Ollama CPU က overload ဖြစ်မယ်။

