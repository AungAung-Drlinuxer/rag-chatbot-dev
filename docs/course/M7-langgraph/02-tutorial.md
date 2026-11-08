## 🔧 Tutorial 7.1 — LangGraph Minimal (ကိုယ်ပိုင် graph တည်ဆောက်)

```python
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
import operator

class State(TypedDict):
    messages: Annotated[list, operator.add]   # accumulate
    step: str

def node_classify(state):
    return {"messages": ["step: classify"], "step": "classify"}

def node_rewrite(state):
    return {"messages": ["step: rewrite"], "step": "rewrite"}

def node_retrieve(state):
    return {"messages": ["step: retrieve"], "step": "retrieve"}

g = StateGraph(State)
g.set_entry_point("classify")
g.add_node("classify", node_classify)
g.add_node("rewrite", node_rewrite)
g.add_edge("classify", "rewrite")
g.add_edge("rewrite", END)

app = g.compile()
result = app.invoke({"messages": []})
print(result["messages"])
# ['step: classify', 'step: rewrite']
```

## 🔧 Tutorial 7.2 — HITL interrupt + resume

```python
from langgraph.types import interrupt, Command

def node_approval(state):
    decision = interrupt({"question": state["question"]})   # graph pause
    return {"decision": decision}

# Run လုပ်ပြီး interrupt မှာ ရပ်သွားမယ်
app = g.compile(checkpointer=checkpointer)
result = app.invoke(initial, config={"configurable": {"thread_id": "user-1"}})

# Admin decide လုပ်ပြီး resume
app.invoke(Command(resume={"decision": "approve"}), config)
```

