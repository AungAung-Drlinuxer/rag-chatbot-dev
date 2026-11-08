# M0 — Project Orientation

## 📖 အသေးစိတ်ရှင်းလင်းချက်

**ဒီ project က ဘာလဲ?**
`rag-chatbot` သည် **Enterprise IT Helpdesk AI Chatbot** ဖြစ်သည်။ Employee တစ်ယောက်က
"How do I reset my VPN password?" လို့ မေးလျှင် —

1. Chatbot သည် ကုမ္ပဏီ Confluence / XWiki / OpenProject KB များမှ **အဖြေနှင့် ကိုက်ညီသော
   စာရွက်စာတမ်းများကို ရှာဖွေ** သည် (Retrieval)။
2. ရှာထားသည့် စာရွက်စာတမ်းများကို LLM ကို **context အဖြစ် ပေးပြီး** အဖြေ **generate** လုပ်သည် (Generation)။
3. အဖြေက ယုံကြည်ရမှုနည်းလျှင် **Jira/OpenProject ticket အလိုအလျောက် ဖွင့်ပေးသည်** (HITL escalation)။

**Architecture သုံးဆင့် (3-Tier):**

| Tier | ဘာလုပ်လဲ | အဓိက Tools |
|---|---|---|
| **Desktop** | User interface (browser + native app) | React 18 + Vite + Tauri 2 |
| **Backend** | API + RAG pipeline + workers | Python 3.12 + FastAPI + LangGraph + Celery |
| **Infra (K8s)** | Databases + LLM + monitoring | CNPG Postgres, Redis, Ollama, Harbor |

**Monorepo ဖြစ်ရခြင်း အကြောင်းရင်း** — ဒီ project တစ်ခုထဲမှာ desktop + backend + infra ပါတာက —
on-prem deployment တစ်ခုတည်းကို **single source of truth** အဖြစ် ထားချင်လို့ဖြစ်သည်။
K8s manifests, backend Python, frontend React — အားလုံးက တစ် repo ထဲမှာ version-matched ရှိနေတယ်။

**Layered Architecture Golden Rules (မှတ်ထားရမည့် အရေးကြီးဆုံး ၆ ခု):**

```
Rule 1: API layer မှာ business logic မရေးရ (routing ပဲ)
Rule 2: orchestration/ က အလုပ်လုပ်နိုင်တဲ့ module တွေကို ခေါ်နိုင်
        (orchestration → classifier, rag, llm)
Rule 3: Persistence/DB access ကို persistence/ ထဲမှာပဲ isolate ထားရမယ်
Rule 4: External systems (Jira, Confluence, LDAP, K8s) ကို integrations/ မှပဲ ထိရမယ်
Rule 5: Business vocabulary/threshold/routing rules ကို YAML config မှာ ထားရမယ်
Rule 6: ကြာနိုင်တဲ့ background အလုပ်တွေက workers/ ထဲမှာသာ run ရမယ်
```

**ဘာလို့ ဒီလို ခွဲရလဲ?** — Layer တစ်ခု ပြောင်းလဲတဲ့အခါ တခြား layer တွေ မထိခိုက်စေရန်။
ဥပမာ — KB storage ကို Confluence က XWiki သို့ ပြောင်းရင် **integrations/xwiki.py** နဲ့
**loaders.py** ပဲ ပြင်ရမည် — RAG pipeline code လုံးဝ မထိရ။

## 🧭 လေ့လာပုံအဆင့်ဆင့်

1. `D:\ragchatbot` repo ကို open လုပ်
2. အောက်ပါ file များကို **မဖတ်ခင် အရင်ပုံစံ (structure) ကြည့်** — 5 မိနစ်
   - `backend/app/main.py` (FastAPI entry)
   - `frontend/src/App.tsx` (UI router)
   - `infra/k8s/00-namespace.yaml` (K8s ns)
3. Production cluster ထဲ ပုံစံ ကြည့် — `kubectl -n rag-chatbot get pods` (memory မှာ cluster ရှိနေပြီးသား)
4. Course guide §0.1 directory map နဲ့ တိုက်ဆိုင်စစ်

