# Jira Reconciliation — mirror ကို Jira နဲ့ ကိုက်ညီအောင် ထိန်းခြင်း

`jira_tickets` က Jira ရဲ့ **mirror** ပါ။ Ticket တင်ချိန်မှာ row တစ်ခု ဆောက်တယ်၊
list ဖတ်တိုင်း status ကို refresh လုပ်တယ်။ ဒါပေမယ့် **Jira မှာ issue ဖျက်လိုက်တာ** ကို
ဘယ်လမ်းကနေမှ မသိနိုင်ပါ — ဖျက်ထားတဲ့ ticket က board ပေါ်မှာ ဆက်ပေါ်နေတယ်။

Reconciliation က အဲဒီလမ်းကြောင်းကို ဖြည့်တာပါ: mirror ထဲက key တိုင်းကို Jira ကို
မေးပြီး ကိုက်ညီအောင် ပြင်တယ်။

## ၁။ ဆုံးဖြတ်ချက် ၃ မျိုး

| Jira ရဲ့ အဖြေ | လုပ်ဆောင်ချက် |
|---|---|
| **404** (issue မရှိတော့) | row ကို `status='deleted'` + `remote_missing_at` သတ်မှတ် → board ပေါ်က ဖျောက် (row ကို မဖျက် — escalation ဖြစ်ခဲ့တာ မှတ်တမ်း) |
| **200 + status** | canonical status (`open \| pending \| resolved \| closed`) ကို လိုက်ယူ; အရင် `deleted` ဖြစ်ခဲ့ရင် ပြန်ရှင် |
| timeout / 401 / 500 / မဖွင့်ထား | **ဘာမှ မလုပ်** — Jira ပျက်နေတာ ticket ဖျက်တာ မဟုတ် |

နောက်ဆုံးအချက်က အရေးကြီးဆုံး: outage တစ်ခုက board ကို ရှင်းပစ်လိုက်ရင် ဒါက data
ဆုံးရှုံးမှုပါ။ ဒါကြောင့် 404 တစ်ခုတည်းကိုပဲ delete အဖြစ် သတ်မှတ်တယ်။

## ၂။ ဘယ်အချိန် run လဲ

- **Nightly 03:15 UTC** — Celery beat (`reconcile-jira` → `workers.sync_tasks.reconcile_jira`)
- **Manual** — Tickets စာမျက်နှာရဲ့ **Reconcile** ခလုတ် (admin/agent) ဒါမှမဟုတ်
  `POST /api/tickets/reconcile?limit=200`

Manual က Jira မှာ issue ဖျက်ပြီးတာနဲ့ ချက်ချင်း board ရှင်းချင်တဲ့အခါ သုံးပါ။
Nightly run က 500 key အထိ စစ်တယ်; manual က default 200။

## ၃။ စစ်ဆေးပုံ

```bash
# nightly schedule ရှိလား
kubectl -n rag-chatbot-dev exec deploy/celery-beat -- \
  python -c "from workers.celery_app import celery_app; print(celery_app.conf.beat_schedule['reconcile-jira'])"

# ကိုယ်တိုင် run (backend pod ထဲကနေ)
kubectl -n rag-chatbot-dev exec -i deploy/backend -- python - <<'PY'
from app.integrations.jira_reconcile import reconcile_jira
print(reconcile_jira(limit=200))
PY
# → {"checked": 4, "missing": 0, "updated": 0, "revived": 0, "unreachable": 0, ...}

# DB မှာ ဘာတွေ deleted ဖြစ်နေလဲ
kubectl -n rag-chatbot-dev exec postgres-dev-1 -- psql -U postgres -d assistant -c \
  "SELECT jira_key, status, remote_missing_at FROM jira_tickets WHERE status='deleted';"
```

## ၄။ Code

- `backend/app/integrations/jira_reconcile.py` — `decide()` (pure rules) + `reconcile_jira()`
- `backend/app/integrations/jira.py::fetch_issue_status` — 404 ကို `missing: True` နဲ့ ပြန်တယ်
- `backend/workers/sync_tasks.py` — `reconcile_jira_task`
- `backend/workers/celery_app.py` — beat schedule
- `backend/app/api/tickets.py` — `list_tickets` က `deleted` ကို ဖယ်; `POST /api/tickets/reconcile`
- `frontend/src/features/tickets` — **Reconcile** ခလုတ် (toast နဲ့ ရလဒ်ပြ)

## ၅။ သတိထားရန်

- Ticket ကို Jira မှာ **ဖျက်လိုက်တာ** နဲ့ **archive/permission ပြောင်းလိုက်တာ** က
  Jira မှာ နှစ်မျိုးတူတူ 404 ပြန်နိုင်တယ်။ ဒါကြောင့် row ကို ဖျက်မပစ်ဘဲ `deleted`
  အဖြစ် မှတ်ထားတယ် — လိုအပ်ရင် ပြန်ရှင်စေနိုင်တယ်။
- Jira credential မရှိရင် `unreachable` တိုးပြီး ဘာမှ မပြောင်းဘူး; Settings → Integrations
  မှာ Jira ကို အရင် စစ်ပါ။
- 500 key အထက်ရှိရင် nightly run က အစ 500 ကိုပဲ စစ်တယ် — `limit` ကို တိုးချင်ရင်
  `reconcile_jira_task` ထဲ ပြင်ပါ။
