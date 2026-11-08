# 🎓 Final Capstone Exercise

အောက်ပါ **end-to-end trace** ကို ကိုယ်တိုင် စာရွက်ပေါ်မှာ ရေးပါ —

```
User logs in (LDAP) → JWT issued →  "How do I renew SSL?"
  → POST /api/chat/stream (SSE)
    → guardrail.check (regex match?) → 5ms
    → classify.domain → "network" 
    → rewrite.query → "SSL certificate renewal"
    → retrieve.hybrid → vector+BM25 → RRF → 8 hits
    → rerank.svc → top1: 0.82 → gate 0.75+ → "answer"
    → prompt assembly → OpenRouter stream
    → SSE token* → done {latency_ms: 15432, usage: {...}}
```

**မေးခွန်း** — အဆင့်တိုင်းမှာ —
1. ဘယ် file မှာ လုပ်လဲ?
2. ဘယ် span မှာ မှတ်လဲ?
3. ဘယ် metric တက်မလဲ?
4. Fail ဖြစ်ရင် ဘယ် degrade path သုံးမလဲ?

**တုံ့ပြန်မှုအားလုံးကို အချိန်နှင့်တပြိုင်နက် Grafana + Tempo မှာ တွေ့ရမည်။**

---

> **Workbook အဆုံးသတ်** — M0–M11 အားလုံး ပြီးလျှင် —
> **Course Guide** (`docs/course-project-guide.md`) ကို ပြန်ဖတ်ပြီး
> Verification Checklist ၇ ခုလုံး ကိုယ်တိုင် စမ်းပါ။
> **ဒီ workbook** က **how to do** (လက်တွေ့ လမ်းညွှန်) ဖြစ်ပြီး
> **course guide** က **what/why** (အကြောင်းအရာ ရှင်းလင်းချက်) ဖြစ်ပါသည်။
