## 🔧 Tutorial 4.1 — Celery Task ရေးတဲ့ အခြေခံ

```python
# backend/workers/celery_app.py
from celery import Celery
from celery.schedules import crontab

celery_app = Celery(
    "worker",
    broker="redis://localhost:6379/0",
    backend="redis://localhost:6379/1",
)

celery_app.conf.beat_schedule = {
    "sync-kb": {
        "task": "workers.sync_tasks.sync_kb",
        "schedule": crontab(minute="*/30"),   # ၃၀ မိနစ် တစ်ကြိမ်
    }
}

# backend/workers/sync_tasks.py
from workers.celery_app import celery_app

@celery_app.task(name="workers.sync_tasks.sync_kb")
def sync_kb():
    from app.knowledge.ingest import sync_all
    result = sync_all(updated_by="celery-beat")
    return {"synced": len(result)}
```

```bash
# Run worker + beat (Windows: `-P solo` for Celery 5.3+)
uv run celery -A workers.celery_app worker -P solo -l info
uv run celery -A workers.celery_app beat -l info

# Task result စစ်
docker exec -it backend-redis-1 redis-cli KEYS "celery-task-meta*"
```

## 🔧 Tutorial 4.2 — Redis Sentinel Live Test (Production Cluster)

```bash
# Sentinel ဘယ် node က master လဲ မေးကြည့်
kubectl -n rag-chatbot exec redis-sentinel-0 -c sentinel -- \
  redis-cli -p 26379 sentinel get-master-addr-by-name mymaster

# Expected output:
# 1) "redis-data-0.redis-data-headless.rag-chatbot.svc.cluster.local"
# 2) "6379"

# ACL — celery pidbox pubsub channels (channel access လိုအပ်)
kubectl -n rag-chatbot exec redis-data-0 -c redis -- \
  redis-cli -a "$REDIS_PASSWORD" ACL LIST | head -3
# မျှော်မှန်: "user default ... allchannels +@all"
```

## ⚠️ Redis/Celery Gotchas

1. **`sentinel resolve-hostnames yes` မထည့်ရင်** — pod name ကို မဖြေရှင်းနိုင်ဘူး
2. **`allchannels` ACL** မထည့်ရင် Celery pidbox pubsub ပျက်မယ် (chatbot "No permissions")
3. **backend image bump လုပ်တိုင်း** — celery-worker နဲ့ celery-beat ကို **တစ်ပြိုင်နက်** redeploy လုပ်ရမယ် (same image)

