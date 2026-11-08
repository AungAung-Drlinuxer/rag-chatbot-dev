# M7 — LangGraph Crash Course (စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — LangGraph ကို လုံးဝ မသိသေးသူများအတွက် — state machine
> နှင့် Human-in-the-Loop (HITL) concept များကို အခြေခံကနေ မြန်မာလို အသေးစိတ် သင်ကြားပါသည်။
> **မဖတ်ခင်** — M2 (FastAPI) ပြီးသင့်သည်။

---

## 📚 Lessons

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | LangGraph ဆိုတာ + ဘာလို့ လိုလဲ | 🟢 |
| **L2** | StateGraph + Nodes + Edges အခြေခံ | 🟡 |
| **L3** | Conditional Edges (branching) | 🟡 |
| **L4** | HITL — interrupt() + Command(resume) | 🔴 |
| **L5** | Checkpointer (Postgres) + LangGraph vs Traditional | 🔴 |
| **Lab** | Minimal graph + HITL end-to-end တည်ဆောက် | 🔴 |

---

# Lesson 1 — LangGraph ဆိုတာ ဘာလဲ

**LangGraph က LLM application များကို graph (node + edge) အနေနဲ့ တည်ဆောက်နိုင်တဲ့
framework** — LangChain မိသားစုမှ ထွက်သည်။

**Traditional RAG pipeline က ဖြောင့်ဖြောင့် သွားသည် (linear):**
```
query → retrieve → answer → done
```

**LangGraph က branching + loop + HITL ပါသည်:**
```
query → retrieve → gate ─┬─ conf < 0.75 → retry loop (rewrite again)
                         └─ conf ≥ 0.75 → answer → done
```

**ဒီ project မှာ ဘာလို့ လိုလဲ?**
1. **Retry loop** — retrieval weak ဖြစ်လျှင် different keywords နဲ့ ထပ်ရှာမယ်
2. **HITL** — ticket creation က **admin approval** လိုသည် (human decide လုပ်ပြီးမှ)
3. **Agentic tools** — "my ticket status?" မေးရင် live DB ကို ကြည့်မယ် (LLM မဟုတ်)

Traditional pipeline က ၃ ခုစလုံး မလုပ်နိုင်ဘူး — ဒါကြောင့် LangGraph။

---

# Lesson 2 — StateGraph + Nodes

**Node** = function (state → state update)။ **State** = TypedDict (data shared across nodes)။

```python
from typing import TypedDict
from langgraph.graph import StateGraph, END

class State(TypedDict):
    question: str
    domain: str
    docs: list
    confidence: float
    decision: str

def node_classify(state: State) -> dict:
    # pure function — state in → state update out
    domain = classify_domain(state["question"])
    return {"domain": domain}        # only the fields you update

def node_rewrite(state: State) -> dict:
    rewritten = rewrite_query(state["question"])
    return {"question": rewritten}

g = StateGraph(State)
g.set_entry_point("classify")
g.add_node("classify", node_classify)
g.add_node("rewrite", node_rewrite)
g.add_edge("classify", "rewrite")
g.add_edge("rewrite", END)

app = g.compile()
result = app.invoke({"question": "how do I set it up?"})
print(result["domain"])     # node updates merged automatically
```

**ဘာလို့ "pure functions"?** — Node များက state ကို **ပြင်မရေး** (no side effects) —
repeat run လုပ်လျှင် same result — **deterministic** ဖြစ်သည်။

---

# Lesson 3 — Conditional Edges (branching)

```python
def route_by_gate(state: State) -> str:
    """Return the NAME of the next node based on state."""
    if state["decision"] == "answer":
        return "context"        # → continue to answer
    if state["confidence"] < 0.5:
        return "rewrite"        # retry loop
    return "context"            # still answer with caution

g.add_edge("retrieve", "gate")
g.add_conditional_edges("gate", route_by_gate, ["context", "rewrite"])
```

**ဒီ project ရဲ့ actual graph:**
```
classify → rewrite → retrieve → gate ─┬─ (retry) → rewrite
                                      └─ → context → tools ─┬─ answer → END
                                                            └─ escalate → approval ⏸
approval ─┬─ ticket → create_ticket → END
          └─ rejected → END
```

---

# Lesson 4 — HITL (Human-in-the-Loop) ⭐

## ပြဿနာ

User က "create a ticket for my broken laptop" လို့ မေးလျှင် —
chatbot က **တိုက်ရိုက် Jira ticket မဖန်တီးသင့်ဘူး** — **admin က approve** ပြီးမှ ဖြစ်ရမယ်။

## Solution — `interrupt()`

```python
from langgraph.types import interrupt, Command

def _node_approval(state: State) -> dict:
    """Graph PAUSES at this node until admin decides."""
    decision = interrupt({
        "question": state["question"],
        "confidence": state["confidence"],
    })
    # ← graph stops here, state saved to checkpointer
    # admin visits approval UI, clicks approve/reject
    if decision == "approved":
        return {"decision": "escalate"}
    return {"decision": "rejected"}
```

**Flow:**
```python
# 1st run — graph stops at approval node
result = app.invoke(initial_state, config={"configurable": {"thread_id": "user-1"}})
# result contains "interrupt" payload — send approval_request to admin UI

# Admin approves — resume via Command(resume=...)
app.invoke(Command(resume={"decision": "approved"}),
           config={"configurable": {"thread_id": "user-1"}})
```

**Checkpointer က ဘာလို့ လိုလဲ** — `MemorySaver` (in-memory) ဖြစ်နေလျှင်
app restart ဖြစ်လျှင် pending approvals များ **ပျောက်သွားမယ်**။
**Postgres checkpointer** က state ကို DB ထဲ သိမ်းလို့ — restart-safe၊
**multi-replica share** လုပ်နိုင်သည် (HPA ၂၅ pod မှာ အားလုံး မြင်မယ်)။

---

# Lesson 5 — Agentic Tool Node

`tools/ticket_tool.py` — "my ticket ITHD-5 status?" မေးလျှင် —

```python
def detect_ticket_status_intent(query: str) -> bool:
    q = query.lower()
    if _TICKET_ID.search(query):            # ITHD-5, OP-42 pattern
        return True
    if any(w in q for w in ("status", "progress", "track")) and \
       any(w in q for w in ("ticket", "issue", "my")):
        return True
    return False

# tools node
if detect_ticket_status_intent(q):
    ctx, rows = fetch_ticket_context(user, q)     # RBAC-scoped SQL!
    if ctx:
        return {"tool_used": "tickets",
                "ticket_rows": rows,
                "confidence": 0.95,               # gate bypass
                "decision": "answer"}
```

**RBAC အရေးကြီး** — user က မိမိ tickets ကိုပဲ မြင်ရမည် (`WHERE created_by = :user`)။
Admin/agent ဆို အားလုံး မြင်မယ်။

---

# 🔧 Lab 7.1 — Minimal Graph (သုညမှ)

```python
from typing import TypedDict, Annotated
import operator
from langgraph.graph import StateGraph, END

class State(TypedDict):
    messages: Annotated[list, operator.add]
    step: str

def node_classify(state):
    return {"messages": ["[classify]"], "step": "classify"}

def node_rewrite(state):
    return {"messages": ["[rewrite]"], "step": "rewrite"}

def node_retrieve(state):
    return {"messages": ["[retrieve]"], "step": "retrieve"}

g = StateGraph(State)
g.set_entry_point("classify")
g.add_node("classify", node_classify)
g.add_node("rewrite", node_rewrite)
g.add_node("retrieve", node_retrieve)
g.add_edge("classify", "rewrite")
g.add_edge("rewrite", "retrieve")
g.add_edge("retrieve", END)

app = g.compile()
result = app.invoke({"messages": [], "step": ""})
print(result["messages"])
# → ['[classify]', '[rewrite]', '[retrieve]']
```

---

# 🔧 Lab 7.2 — HITL interrupt + resume

```python
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import MemorySaver

def node_approval(state):
    decision = interrupt({"question": state["question"]})   # pause here
    return {"decision": decision}

g.add_node("approval", node_approval)
app = g.compile(checkpointer=MemorySaver())     # required for interrupt!

# 1st run — stops at approval node
cfg = {"configurable": {"thread_id": "user-1"}}
result = app.invoke({"question": "create a ticket", "decision": None}, cfg)
# result["__interrupt__"] = [{"question": "create a ticket"}]

# Admin decides — resume
result = app.invoke(
    Command(resume={"decision": "approved"}),
    config=cfg
)
print(result["decision"])   # → "approved"
```

**⚠️ Gotcha** — `interrupt()` ကို အသုံးပြုရန် **checkpointer မဖြစ်မနေ လိုအပ်သည်** —
MemorySaver က local dev အတွက် ရ၊ production မှာ **Postgres checkpointer** သုံးရမယ်။

---

# ✅ Self-Check (M7)

1. LangGraph နဲ့ if/else traditional pipeline ကွာပုံက ဘာလဲ?
2. Node တစ်ခုက state ရဲ့ **တစ် field တည်း** ပြန်ပြင်ပေးလျှင် တခြား field များ ဘာဖြစ်မလဲ?
3. `interrupt()` ပြီးရင် graph ဘယ်မှာ ရပ်သွားလဲ? State က ဘယ်မှာ သိမ်းလဲ?
4. MemorySaver နဲ့ Postgres checkpointer ကွာပုံက ဘာလဲ? Production မှာ ဘာလို့ Postgres သုံးလဲ?
5. `LANGGRAPH_ENABLED=0` ဖြစ်နေရင် ဘာဖြစ်မလဲ? (linear fallback path)

---

> **နောက်တစ်ဆင့်** — M8 (LLM Provider) ကို ဆက်လေ့လာပါ။
> ဒီ graph ထဲက generation node က **ကွဲပြားသော provider** တွေကို ဘယ်လို ခေါ်လဲ သင်မယ်။