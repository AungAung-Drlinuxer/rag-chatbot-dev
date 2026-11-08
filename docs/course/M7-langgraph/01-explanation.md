# M7 — LangGraph Orchestration

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### LangGraph ဆိုတာ

LLM workflow ကို **graph structure** နဲ့ တည်ဆောက်နိုင်တဲ့ framework။
Traditional pipeline (linear) မတူသည်မှာ — **conditional branches** (if-else on state) နဲ့
**loops** (retry) နှင့် **HITL (Human-in-the-Loop)** ပါနိုင်သည်။

### ဒီ project မှာ LangGraph က ဘာလို့ လိုသလဲ?

Traditional RAG က **deterministic single-pipeline** — မေးခွန်း → retrieve → answer။
ဒါပေမယ့် Enterprise မှာ —

1. **Retrieval မကောင်းရင် retry** လုပ်ချင် (different keyword strategy နဲ့)
2. **Low confidence ဖြစ်ရင် admin က လက်ခံ/ပယ်ဖျက် ဆုံးဖြတ်ရမယ်** (HITL)
3. **Live data (tickets) မေးရင်** agentic tool ခေါ်ဖို့

LangGraph က ဒီ ၃ ခုကို state machine တစ်ခုအနေနဲ့ ဖြေရှင်းပေးသည်။

### Graph Topology

```python
classify → rewrite → retrieve → gate ─┬─ (retry) → rewrite    ← retry loop
                                      └─ → context → tools ─┬─ answer → END
                                                            └─ escalate → approval ⏸
approval ─┬─ ticket → create_ticket → END                ← HITL
          └─ rejected → END
```

### HITL (interrupt + resume)

```python
# _node_approval ထဲ
@node
def approval(state):
    result = interrupt({"question": state["question"]})  # ← graph pause လုပ်မယ်
    # admin decide လုပ်လိုက်တဲ့အခါ —
    #   graph resume via Command(resume={"decision": "approved"})
    if result["decision"] == "ticket":
        return {"decision": "escalate"}
    return {"decision": "rejected"}
```

**Postgres Checkpointer** — `MemorySaver` အစား — graph state ကို DB ထဲသိမ်း။
App restart ဖြစ်လျှင် pending approval များ မပျောက်ပါ (replica ၂၅ လုံးကြား share လုပ်နိုင်)။

### Agentic Tool Node

`tools/ticket_tool.py` — "what is my ticket ITHD-32 status?" မေးလျှင် —

```python
detect_ticket_intent(query) → {"intent": "ticket_status", "ref": "ITHD-32"}
→ RBAC-scoped SQL (user က own ticket ကိုပဲ မြင်နိုင်)
→ context prepend + confidence forced 0.95 (gate bypass)
→ KB sources dropped (table-only answer)
```

