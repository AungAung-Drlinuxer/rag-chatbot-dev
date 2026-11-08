# Monitoring — dev

Prod ရဲ့ pipeline ကို reference ယူထားပါတယ်:

- **Grafana Alloy** က `/metrics` တွေကို scrape
- **Prometheus** `http://10.10.10.18:9090` ကို remote_write
- **Grafana** `http://10.10.10.18:3000` က dashboard ပြ

ကွာခြားချက်: dev က **ကိုယ်ပိုင် Alloy** ကို `rag-chatbot-dev` namespace ထဲမှာ run တယ်။
အကြောင်းရင်း — ပလက်ဖောင်း `monitoring/alloy-config` က အခြားသူပိုင်ဖိုင်; အဲဒီထဲ dev
scrape job ထည့်ရင် platform upgrade တစ်ခါမှာ ပျောက်နိုင်တယ်၊ dev change တစ်ခုက prod
metrics ကို ဖျက်နိုင်တယ်။

## ၁။ ဘာတွေ ရနေလဲ

`infra/k8s-dev/45-monitoring.yaml` က:

- ServiceAccount + **namespaced** Role (pods/services/endpoints get/list/watch) — secret
  ဖတ်ခွင့် မပါ
- ConfigMap `alloy-dev-config` — dev backend pods ကို 15s တစ်ခါ scrape
- Deployment `alloy` (replicas **1**, strategy Recreate)

Series တွေမှာ ဒီ labels ပါတယ်:

```
job="prometheus.scrape.chatbot_backend_dev"   # Alloy က component နာမည်ကို job အဖြစ် သုံး
namespace="rag-chatbot-dev"
environment="dev"
pod="backend-…", app="backend"
```

`environment="dev"` က prod series တွေနဲ့ မရောအောင် ခွဲထားတာ — dashboard တစ်ခုတည်းမှာ
`environment` switch လုပ်လို့ ရတယ်။

## ၂။ စစ်ဆေးပုံ

```bash
# Alloy က target မြင်နေလား (targets array ထဲ address ရှိရမယ်)
kubectl -n rag-chatbot-dev port-forward deploy/alloy 12345:12345 &
curl -s localhost:12345/api/v0/web/components/prometheus.scrape.chatbot_backend_dev

# Prometheus ဆီ ရောက်လား
curl -s --get http://10.10.10.18:9090/api/v1/query \
  --data-urlencode 'query=up{job="prometheus.scrape.chatbot_backend_dev"}'
# → value 1 ဖြစ်ရမယ်

# scrape မလုပ်တော့ရင်
kubectl -n rag-chatbot-dev logs deploy/alloy --tail=50 | grep -iE 'error|fail'
```

## ၃။ Dashboard

`infra/monitoring/grafana-rag-chatbot-dev.json` ကို Grafana မှာ import လုပ်ပါ —
**Dashboards → New → Import → Upload JSON**၊ datasource ကို Prometheus ရွေး။

Panels: backend up · chat requests/s by decision · p50/p95 latency · RAG stage p95 ·
confidence-gate decisions · guardrail events · process RSS · scrape duration · LLM tokens/s။

ကိုယ်တိုင် query ရေးချင်ရင်:

```promql
# request rate
sum by (decision) (rate(chat_requests_total{environment="dev"}[5m]))

# p95 latency
histogram_quantile(0.95,
  sum by (le) (rate(chat_latency_seconds_bucket{environment="dev"}[5m])))

# ဘယ် stage က နှေးလဲ
histogram_quantile(0.95,
  sum by (stage, le) (rate(rag_stage_latency_seconds_bucket{environment="dev"}[5m])))

# scrape ရပ်သွားလား
up{job="prometheus.scrape.chatbot_backend_dev"} == 0
```

## ၄။ သတိထားရန်

- **replicas ကို ၁ ထက် မတင်ပါနဲ့** — collector နှစ်ခုက target တူတူကို scrape ရင်
  timestamp နှစ်မျိုး ရောပြီး remote_write က "out of order sample" နဲ့ ပယ်တယ်; dashboard
  က အလွတ်ဖြစ်သွားမယ်။
- `discovery.kubernetes` မှာ `namespaces { names = ["rag-chatbot-dev"] }` မဖြစ်မနေ ပါရမယ် —
  namespaced Role နဲ့ cluster-wide list လုပ်ရင် 403 ဖြစ်ပြီး target သုည ဖြစ်နေတယ်
  (error မတက်ဘဲ တိတ်တဆိတ် လွတ်သွားတယ်)။
- ConfigMap ပြင်ပြီးတိုင်း `kubectl -n rag-chatbot-dev rollout restart deploy/alloy` —
  Alloy က config ကို start ချိန်မှာပဲ ဖတ်တယ်။
- Dev မှာ node/cAdvisor/KSM metrics ကို မထပ်ခေါ်ပါ — cluster-wide ဖြစ်လို့ platform
  collector က ရှိပြီးသား ယူထားတယ်။
- `chat_*` metrics တွေ traffic မရှိသေးရင် ပေါ်မလာဘူး; panel က "No data" ပြတာ ပုံမှန်ပါ။
