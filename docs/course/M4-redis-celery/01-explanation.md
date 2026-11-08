# M4 — Redis + Celery (Async Jobs & Queue HA)

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Redis က ဒီ project မှာ ၃ ရပ် အလုပ်လုပ်သည်

1. **Celery Broker** — KB sync task များ queue လုပ် (Confluence/XWiki fetch)
2. **Result Backend** — task result သိမ်း (worker ပြီးပြီလား)
3. **Rate Limiting** — `@limit("chat")` — ၅ req/min ကန့်သတ်ခြင်း

### Standalone vs Sentinel

| Mode | Pros | Cons |
|---|---|---|
| **Standalone** (single node) | ရိုးရှင်း | Redis down → rate-limit fail-open (permit), Celery task ကျနေမယ် |
| **Sentinel** (3 nodes) | Automatic failover (30s) | Setup ရှုပ် — sentinel quorum လို |

**Sentinel config (K8s ConfigMap):**
```yaml
sentinel.conf:
  sentinel resolve-hostnames yes      # ⚠️ ဒါမထည့်ရင် hostname resolve မရ
  sentinel monitor mymaster redis-master 6379 2
  sentinel auth-pass mymaster <password>
```

**K8s pods:**
```
redis-data-0/1/2           → data nodes (1 master + 2 replicas)
redis-sentinel-0/1/2       → monitor + failover (3 pods quorum)
```

### Celery Architecture

```
backend (API)              celery-worker           celery-beat
     │                           │                       │
     │  push task to queue       │  pull from queue      │ every 30 min
     │  "sync-kb" ─────────────► │  run sync_all()       │ push sync-kb task
     │                           │                       │
     └──── Redis (broker) ◄─────┴───────────────────────┘
```

- **celery-worker** — task run (multi-process)
- **celery-beat** — scheduler (crontab လိုပဲ)

