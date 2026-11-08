# M4 — Redis + Celery Crash Course (စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — Redis နှင့် Celery ကို လုံးဝ မသိသေးသူများအတွက် — ဒီ project မှာ
> ဘာလို့ လိုအပ်သလဲ၊ ဘယ်လို အလုပ်လုပ်လဲ၊ ဘယ်လို deploy လုပ်ထားလဲ ကို မြန်မာလို အသေးစိတ်သင်ကြားပါသည်။

---

## 📚 Lessons

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | Redis ဆိုတာ — Key/Value store + ဘာလို့ လိုလဲ | 🟢 |
| **L2** | Redis Data Structures + Commands | 🟢 |
| **L3** | Celery — Async Task Queue အခြေခံ | 🟡 |
| **L4** | Beat Scheduler + Periodic Tasks | 🟡 |
| **L5** | Sentinel HA (Master/Replica + Failover) | 🔴 |

---

# Lesson 1 — Redis ဆိုတာ

**Redis** က **in-memory key/value store** — data ကို RAM ထဲမှာ သိမ်းသည်
(磁盘 disk မဟုတ်)၊ ဒါကြောင့် **ပျော်ပြီး အမြန်** (10x–100x faster than disk DB)။

**ဒီ project မှာ Redis ၃ ရပ် အလုပ်လုပ်သည်:**

| အလုပ် | ဥပမာ |
|---|---|
| **Celery Broker** | KB sync task များ queue လုပ် |
| **Rate Limiting** | `@limit("chat")` — 5 req/min per user |
| **Cache** | hot settings (LLM config 30s TTL) |

**ဘာလို့ ဒီ ၃ ခုမှာ Redis ကို သုံးလဲ?**
- Data က **transient** (အချိန်ကာလ ကုန်လျှင် ပျက်သွားနိုင်) — disk မလို
- **Atomic operations** — `INCR`, `SETNX` စသည်ဖြင့် race-condition မရှိ
- Sub-ms latency (rate limiting မှာ အရေးကြီး)

---

# Lesson 2 — Redis Commands (Essential)

```bash
redis-cli

# --- String (key/value) ---
SET mykey "hello"
GET mykey                 # → "hello"
SET session:dev "abc123" EX 3600    # TTL 1 hour

# --- Counter (rate limit အတွက်) ---
INCR request:dev          # 1 → 2 → 3 ...
EXPIRE request:dev 60     # 60 စက္ကန့် နောက် မှတ်တမ်း ပျက်မယ်

# --- Lists (queue) ---
LPUSH tasks "job-1"
RPOP tasks                # → "job 1" (FIFO)

# --- Pub/Sub (celery pidbox သုံးသည်) ---
PUBLISH channel-1 "hello"
SUBSCRIBE channel-1
```

**Rate Limiting Pattern (ဒီ project အတိုင်း):**
```python
from redis import Redis
r = redis.Redis()

def check_rate_limit(user_id: str) -> bool:
    key = f"rl:{user_id}:{int(time.time() // 60)}"   # per-minute window
    count = r.incr(key)
    if count == 1:
        r.expire(key, 60)
    return count <= 5   # 5 req/min limit
```

---

# Lesson 3 — Celery အခြေခံ

**Celery က Python မှာ background tasks ဖြင့် လုပ်ဆောင်ရန် library** —
API request တစ်ခုက ရှည်လျှားတဲ့ အလုပ် (KB sync 30s+) မလုပ်ရဘူး၊
**queue ထဲ ထည့်ပြီး worker က နောက်မှာ လုပ်မယ်**။

## Architecture

```
FastAPI (API server)             Celery Worker            Redis (broker)
     │                                │                       │
     │ "sync-kb" task တင်            │ task pull             │
     │ ────────────────────────────► │ ──────────────────────┤
     │                               │ run sync_all()        │
     │                               │ ──────────────────────►│
     │                          result save (redis /1)
```

## Code

```python
# celery_app.py
from celery import Celery
from celery.schedules import crontab

celery_app = Celery(
    "worker",
    broker="redis://localhost:6379/0",       # task queue
    backend="redis://localhost:6379/1",      # result storage
)

# Periodic task (cron-like)
celery_app.conf.beat_schedule = {
    "sync-kb": {
        "task": "workers.sync_tasks.sync_kb",
        "schedule": crontab(minute="*/30"),    # every 30 min
    }
}

# sync_tasks.py
from workers.celery_app import celery_app

@celery_app.task(name="workers.sync_tasks.sync_kb")
def sync_kb():
    from app.knowledge.ingest import sync_all
    return {"synced": sync_all(updated_by="celery-beat")}
```

## Run (Development)

```bash
# Worker (Windows မှာ solo pool ကို သုံးရမယ်)
uv run celery -A workers.celery_app worker -P solo -l info

# Beat (scheduler) — သီးခြား process
uv run celery -A workers.celery_app beat -l info

# Manual task trigger
uv run celery -A workers.celery_app call workers.sync_tasks.sync_kb
```

**⭐ မှတ်ထားရမည်** — backend + celery-worker + celery-beat သည် **တစ် docker image တည်း**
ဖြစ်သည် — deployment တိုင်းမှာ ၃ ခုစလုံး အတူတကွ bump လုပ်ရမယ် (version mismatch ရှိမနေရန်)။

---

# Lesson 4 — Beat Scheduler

**Beat ကို "cron daemon" လို့ မှတ်ထား** — အချိန်ပုံစံအလိုက် task တင်သည်။

```python
from celery.schedules import crontab

beat_schedule = {
    # every 30 minutes
    "sync-kb": {"task": "sync_kb", "schedule": crontab(minute="*/30")},

    # every day at 3 AM
    "daily-maintenance": {"task": "daily_task", "schedule": crontab(hour=3, minute=0)},

    # every Monday 8 AM
    "weekly-report": {"task": "weekly", "schedule": crontab(hour=8, minute=0, day_of_week=1)},
}
```

**ဘာလို့ 30-min sync?**
- Confluence/XWiki တွင် content change ဖြစ်နိုင်သည်
- 30 မိနစ် တစ်ကြိမ် sync လုပ်လျှင် — user ရဲ့ KB search သည် **နောက်ဆုံး 30 min** အထိ မှန်သည်
- ကြိုးစားစရာမလိုဘူး — content_hash change detection က cost လျှော့ပေးသည်

---

# Lesson 5 — Redis Sentinel (HA)

## ရှင်းလင်းချက်

Sentinel က **Redis Master failover လုပ်ပေးသည့် separate process** —
master ပျက်လျှင် replica တစ်ခုကို master အဖြစ် **အလိုအလျောက် တိုးမြှင့်** ပေးသည်။

```
Before:
  redis-data-0  ← master (writes)
  redis-data-1  ← replica
  redis-data-2  ← replica

After master-0 fails (sentinel detect in 10s):
  redis-data-1  ← NEW master (sentinel promotes)
  redis-data-0  ← down (recovering)
  redis-data-2  ← replica (of data-1 now)
```

## Config (quorum = 2 of 3 sentinels must agree)

```
sentinel monitor mymaster redis-data-0 6379 2      # master name + 2 sentinels needed
sentinel down-after-milliseconds mymaster 10000    # 10s after no response
sentinel failover-timeout mymaster 180000
sentinel resolve-hostnames yes                     # ⚠️ K8s pod DNS အတွက် မဖြစ်မနေ
sentinel auth-pass mymaster <password>             # password မပါရင် auth fail
```

## Backend Connection (Sentinel mode)

```python
# env
REDIS_MODE=sentinel
REDIS_SENTINELS=redis-sentinel-0:26379,redis-sentinel-1:26379,redis-sentinel-2:26379
REDIS_MASTER_NAME=mymaster

# code (persistence/redis.py)
from redis.sentinel import Sentinel
sentinel = redis.sentinel.Sentinel([(h, p) for h, p in sentinels])
master = sentinel.master_for("mymaster", password=PW)
```

## 🔧 Lab 4.2 — Sentinel Live Test

```bash
unset KUBECONFIG

# 1) Who is master?
kubectl -n rag-chatbot exec redis-sentinel-0 -c sentinel -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name mymaster
# → redis-data-0... 6379

# 2) ACL (celery needs pubsub channels!)
kubectl -n rag-chatbot exec redis-data-0 -c redis -- \
  redis-cli -a "$REDIS_PASSWORD" ACL LIST
# Expect: "user default ... allchannels +@all"
```

## ⚠️ Sentinel Gotchas (ကျွန်တော်တို့ ကြုံဖူးတဲ့ ပြဿနာများ)

1. `resolve-hostnames yes` မပါရင် K8s pod names မဖြေရှင်းနိုင်
2. `allchannels` ACL — celery pubsub အတွက် မထည့်ရင် worker ပျက်မယ်
3. `sentinel.conf` ရဲ့ newline တစ်ခု နောက်ဆုံး — file အဆုံးမှာ trailing newline မပါရင် `replicaof ...` နဲ့ ပေါင်းသွားမယ် (config error)
4. **backend redeploy တိုင်း celery-worker/beat ကို အတူ bump လုပ်ရမယ်** (same image)

---

# ✅ Self-Check (M4)

1. Redis broker vs result backend — ဘာကွာလဲ? (two databases /0 vs /1)
2. Rate limit က fail-open ဖြစ်ရတဲ့ အကြောင်းက ဘာလဲ? (availability vs correctness)
3. `crontab(minute="*/30")` နဲ့ `crontab(hour="*/30")` ကွာလား?
4. Sentinel quorum ၂ လုံး ဆိုတာ ဘာလဲ? ဘာလို့ ၃ sentinels မှာ ၂ ခု လိုလဲ?
5. Celery worker နဲ့ beat က **same docker image** ဖြစ်ရတဲ့ အကြောင်းရင်း ဘာလဲ?

---

> **နောက်တစ်ဆင့်** — M5 (KB Ingestion) ကို ဆက်လေ့လာပါ။
> **ဆက်စပ်ဖတ်ရန်** — `VALKEY_STUDY_GUIDE.md` (onprem-ai-assistant/docs/ ထဲ)