# M3 — PostgreSQL + pgvector

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### pgvector ဆိုတာ

PostgreSQL extension တစ်ခု — **vector data type + similarity operators** ထည့်ပေးသည်။
AI embedding များကို relational database ထဲမှာပဲ သိမ်းနိုင်စေသည်။

**အဓိက operations:**

| Operator | ရှင်းလင်းချက် | Formula |
|---|---|---|
| `<->` | L2 distance (Euclidean) | `sqrt(sum((a_i - b_i)^2))` |
| `<=>` | Cosine distance | `1 - cos_similarity(a, b)` |
| `<#>` | Negative inner product | `-sum(a_i * b_i)` |

ဒီ project က **cosine (`<=>`)** ကို သုံးထားသည် — text embedding တွေအတွက် အကောင်းဆုံး။

### HNSW Index — Approximate Nearest Neighbor

```
m = 16             → တစ်ခုချင်းစီ node ရဲ့ connections အရေအတွက်
ef_construction=64 → build လုပ်ချိန် search အနည်းအကျယ်
ef_search = 64     → query လုပ်ချိန် search depth
```

**ဘာလို့ HNSW က မြန်တာလဲ?**
- Brute-force cosine — 60k chunks ရှိရင် 60k comparison လုပ်ရမယ်
- HNSW — hierarchical graph ထဲကနေ nearest neighbor ရှာမယ် (~20-50 comparison)
- Latency: 60k chunks အတွက် **~1-3ms** (index-free query က 100-300ms)

### Hybrid Search အတွက် ၂ Branch

```
Branch A — pgvector HNSW cosine   (semantic/concept match)
Branch B — tsvector GIN (BM25 fallback)  (keyword/acronym match)
        ↓
RRF (Reciprocal Rank Fusion) — နှစ်ခုကို ပေါင်းစပ်
score = Σ 1/(60 + rank_in_branch)
```

**ဘာလို့ ၂ branch လိုလဲ?**
- Vector က **semantic** နားလည် — "how do I reconnect my VPN" နဲ့ "VPN Reconnect Guide" ကို ကိုက်မယ်
- FTS က **keyword** match — "ESC-101", "Cisco", "MTU" လို့ exact code/name တွေကို ရှာပေးနိုင်
- နှစ်ခုစလုံး match ရင် RRF score ပိုမြင့်မယ် — accuracy တက်သည်

### CNPG (CloudNative-PG) — HA Postgres

```yaml
# 3-node cluster: 1 primary + 2 streaming replicas
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata: { name: postgres-ha }
spec:
  instances: 3
  bootstrap:
    initdb: { database: assistant }
```

**ဘာလို့ 3 nodes?** — primary ပျက်လျှင် replica တစ်ခု ချက်ချင်း **failover**
လုပ်နိုင်ရန် + read traffic ကို replica များဆီ ခွဲဝေနိုင်ရန်။

**PgBouncer Pooler** — backend ၂၀ ခန့်ရှိလျှင် connection pool လိုအပ်သည်
(default `max_connections=200`) — `poolMode: transaction` — transaction ပြီးတိုင်း connection ပြန်ပေးမယ်။

