# Overview Dashboard — Panel တွေကို ကိုယ်တိုင် ချိန်ညှိခြင်း

Overview စာမျက်နှာဟာ **Grafana dashboard လိုမျိုး panel တွေနဲ့ ဖွဲ့စည်း** ထားပါတယ်။
Panel တစ်ခုချင်းစီကို create / edit / duplicate / resize / reorder / delete လုပ်နိုင်ပြီး
အဲဒီ layout ကို **user တစ်ယောက်ချင်းစီအတွက် သီးသန့်** သိမ်းထားပါတယ်။ တခြားသူရဲ့
dashboard ကို မထိခိုက်ပါဘူး။

## ၁။ အသုံးပြုပုံ (၃ ခြေလှမ်း)

1. Overview ရဲ့ ညာဘက်အပေါ်က **Customize** ကို နှိပ်ပါ။
2. Panel တွေပေါ်မှာ toolbar ပေါ်လာပါမယ် —
   - **ဆွဲရွှေ့** (drag) လုပ်ပြီး အနေအထား ပြောင်း၊ ဒါမှမဟုတ် `←` / `→` (keyboard)
   - **width** ကို `3/12 … 12/12` ကြား ရွေး
   - ✏️ edit (title / note text / row limit), ⧉ duplicate, 🗑 remove
3. **Save layout** နှိပ်ပါ။ `Cancel` က ဘာမှ မသိမ်းဘဲ ပြန်ထွက်ပါတယ်။

`Reset` က သင့် saved layout ကို ဖျက်ပြီး default board ကို ပြန်ယူပါတယ်
(ဖျက်လိုက်တာ ပြန်မရနိုင်လို့ ဒီ button ကို edit mode ထဲမှာပဲ ပြထားပါတယ်)။

## ၂။ Panel အမျိုးအစားများ

| Type | ပြသတာ | Default width |
|---|---|---|
| `attention` | Dependency down / low-confidence answer စတဲ့ အာရုံစိုက်ရမယ့် signal | 12 |
| `kpis` | Conversations · Resolved · Escalated · Active users | 12 |
| `trend` | ကာလအလိုက် conversation ပမာဏ (outcome အလိုက် ခွဲ) | 8 |
| `quality` | Resolved/Escalated အချိုး + confidence gate pass rate | 4 |
| `needs-review` | Escalated / cautioned conversation စာရင်း | 6 |
| `recent-tickets` | Jira ticket နောက်ဆုံး (status · priority) | 6 |
| `domains` | Knowledge base ကို domain အလိုက် ခွဲပြမှု | 6 |
| `knowledge` | Indexed articles (+ admin ဆိုရင် blocked attacks) | 6 |
| `health` | Dependency တစ်ခုချင်းစီရဲ့ status နဲ့ latency | 6 |
| `note` | ကိုယ်တိုင်ရေးထားတဲ့ စာသား (runbook link, reminder) | 6 |

Panel တစ်ခုချင်းစီရဲ့ **option** က ကိုယ့်အမျိုးအစားနဲ့ သက်ဆိုင်တာပဲ ပြပါတယ် —
ဥပမာ `needs-review` မှာ "rows to show", `note` မှာ စာသား။

## ၃။ Data က ဘယ်ကလာသလဲ

Panel တွေက **အသစ်တစ်ခုမှ data မထုတ်ပါဘူး**။ စာမျက်နှာ တစ်ခါဖွင့်တိုင်း ရှိပြီးသား
endpoint ၇ ခုကို တစ်ခါတည်း ခေါ်ပြီး (`/api/dashboard/stats`, `conversations`, `domains`,
`recent-conversations`, `recent-tickets`, `health`, `gate-trend`) panel အားလုံးကို
အဲဒီ result တစ်ခုတည်းကနေ ဖြည့်ပါတယ်။ ဒါကြောင့် panel ၁၀ ခုထားလည်း request အရေအတွက်
မတိုးပါဘူး။

`note` panel ကလွဲရင် ဘယ် panel မှာ ကိုယ်ရေးထည့်လို့ မရပါဘူး — ဂဏန်းတွေကို UI ကနေ
ပြင်လို့မရအောင် တမင်ထားတာပါ။ Load မအောင်မြင်ရင် value တွေက `—` ဖြစ်ပြီး banner
ပေါ်လာပါတယ်; ဘယ်တော့မှ အတုအယောင် `0` မပြပါဘူး။

## ၄။ သိမ်းဆည်းပုံ (API)

| Method | Path | လုပ်ဆောင်ချက် |
|---|---|---|
| `GET` | `/api/dashboard/layout` | ကိုယ့် layout; မရှိသေးရင် `custom: false` |
| `PUT` | `/api/dashboard/layout` | layout တစ်ခုလုံး အစားထိုးသိမ်း |
| `DELETE` | `/api/dashboard/layout` | ကိုယ့် layout ဖျက် (default ပြန်) |

DB မှာ `dashboard_layouts(username PK, panels jsonb, updated_at)` ဆိုတဲ့ table တစ်ခုတည်း
ရှိပါတယ်။ Panel တွေကို **column အလိုက် မခွဲ** ထားပါဘူး — layout ကို တစ်ခါတည်း
ဖတ်/ရေးတာဖြစ်လို့၊ ပြီးတော့ panel အမျိုးအစားအသစ် ထည့်တိုင်း migration မလိုအောင်ပါ။

သိမ်းတဲ့ format:

```json
{"panels": [
  {"id": "attention", "type": "attention", "title": "", "span": 12, "options": {}},
  {"id": "n1", "type": "note", "title": "On-call", "span": 6,
   "options": {"body": "Rotate the key on Monday."}}
]}
```

## ၅။ စည်းမျဉ်းတွေ (server-side validation)

- Panel အများဆုံး **40**
- `span` က **3–12**; ကျော်လွန်ရင် boundary ကို clamp လုပ်တယ် (error မပေး)
- `id` တူတူ နှစ်ခု မရ — `400 duplicate panel id: …`
- `id` 1–64 char, `type` 1–40 char, `title` 120 char, note 2000 char
- မသိတဲ့ `type` ကို **မဖျက်ပါဘူး** — ဒါကြောင့် အသစ်ထွက်တဲ့ version က သိမ်းထားတဲ့
  layout ကို အဟောင်း version က ဖွင့်လည်း ပျက်မသွားပါဘူး (ဒီ build မှာ မရှိတဲ့ type ကို
  "not available in this build" ဆိုတဲ့ placeholder နဲ့ ပြပါတယ်)

## ၆။ စစ်ဆေးပုံ

```bash
# table ရှိ/မရှိ
kubectl -n rag-chatbot-dev exec postgres-dev-1 -- \
  psql -U postgres -d assistant -tAc "select count(*) from dashboard_layouts"

# API (admin token နဲ့)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://dev-chat.drlinuxer.com/api/dashboard/layout
```

`db-init` Job (`infra/k8s-dev/15-db-init.yaml`) ကို ပြန် run တာနဲ့ ဒီ table က
အလိုအလျောက် ဖန်တီးပါတယ် (`dashboard_layouts` ကို `--init` က ဖန်တီးတဲ့ table list ထဲ
ထည့်ထားပါတယ်)။ ဒါကြောင့် တခြားသူတွေ အသစ် install လုပ်တဲ့အခါ ဘာ manual step မှ
မလိုပါဘူး။

## ၇။ သတိထားရန်

- Layout က **user တစ်ယောက်ချင်း** ဆိုတော့ admin တစ်ယောက်ရဲ့ arrangement က တခြားသူ
  ဆီ မရောက်ပါဘူး; "အားလုံးအတွက် default" ကို ပြင်ချင်ရင် `DEFAULT_LAYOUT`
  (`frontend/src/features/dashboard/panels/types.ts`) ကို code အနေနဲ့ ပြင်ရပါမယ်။
- Panel အားလုံး ဖျက်လိုက်ရင် dashboard က "Add panel" ခလုတ်ပဲ ပြပါတယ် — edit mode
  ထဲမှာ **Reset** ရှိလို့ ပြန်ရနိုင်ပါတယ်။
- ဒီ feature က ဖတ်တဲ့ data ကို မပြောင်းပါဘူး; reporting window (`Last 7/30/90 days`,
  custom range) က panel အားလုံးရဲ့ series တွေကို တစ်ပြိုင်နက် ထိန်းချုပ်ပါတယ်။
