# M0 + M1 + M5 + M9 + M10 — Remaining Crash Course Files (တစ်ပိုင်းတစ်စ ဖြည့်)

> အောက်ပါ crash course များကို M0/M1/M5/M9/M10 များအတွက် အသေးစိတ် ရေးထားပါသည်။
> M2-M4 + M6-M11 က crash course files ရှိပြီးသား။

---

## M0 — Project Orientation Crash Course (ဖြည့်စွက်)

> `M0-orientation/00-crash-course.md`

# M0 Crash Course — Project ကို အရင် နားလည်ပါ

## L1 — ဒီ project က ဘာလုပ်ပေးလဲ

RAG (Retrieval-Augmented Generation) chatbot — user မေးခွန်းတစ်ခု မေးလျှင်
ကုမ္ပဏီ Confluence/KB ထဲမှာ ဆိုင်တဲ့ စာရွက်စာတမ်းများကို ရှာ၊ အဲဒါကို LLM ထဲ ထည့်၊
**grounded** အဖြေ ဖြေပေးသည်။

**မရှိလျှင်:** LLM က hallucinate လုပ်မယ် (မဖြစ်ဖြစ်နိုင်တဲ့ အဖြေ ထုတ်မယ်)
**ရှိလျှင်:** အချက်အလက် အပြည့်အစုံနဲ့ အဖြေ ရသည်

## L2 — Architecture ၃ ဆင့်

| Tier | ဘာလုပ်လဲ | Tools |
|---|---|---|
| **Desktop** | UI (browser + native app) | React 18 + Vite + Tauri |
| **Backend** | API + RAG pipeline + workers | Python + FastAPI + LangGraph + Celery |
| **Infra (K8s)** | DB + LLM + monitoring | CNPG, Redis, Ollama, Harbor |

## L3 — Golden Rules (Layered Architecture)

```
Rule 1: api/ folder — routing ပဲ (business logic မရေးရ)
Rule 2: orchestration/ → classifier, rag, llm (ခေါ်ခွင့်ရှိ)
Rule 3: DB access ကို persistence/ ထဲမှာသာ
Rule 4: External systems (Jira/Confluence) → integrations/ ထဲမှာသာ
Rule 5: Business rules ကို YAML config ထဲ
Rule 6: ကြာနိုင်တဲ့ task များ → workers/
```

**ဘာလို့** — Layer တစ်ခု ပြောင်းလျှင် တခြား layer မထိခိုက်စေရန်။

## 🔧 Lab M0 — Production cluster ကြည့်

```bash
unset KUBECONFIG
kubectl -n rag-chatbot get pods
kubectl -n rag-chatbot get pods -o wide
kubectl -n rag-chatbot get svc
kubectl -n rag-chatbot exec deploy/backend -- pip list | head -20
```

## ✅ Self-Check M0

1. Desktop / Backend / Infra ဘာလို့ ခွဲထားလဲ?
2. KB data source (Confluence/XWiki) က ဘယ် folder ထဲမှာ ကုဒ်ရှိလဲ?
3. Monorepo ဆိုတာ ဘာလဲ? ဘာလို့ သုံးထားလဲ?
