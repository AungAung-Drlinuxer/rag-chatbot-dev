# M8 — LLM Provider + Failover Crash Course (စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — Cloud LLM (OpenRouter/H-Chat) နှင့် on-prem Ollama — **နှစ်ခုစလုံးကို**
> တစ်ပြိုင်နက် အလုပ်လုပ်စေဖို့ **failover pattern** ကို အခြေခံကနေ သင်ကြားပါသည်။

---

## 📚 Lessons

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | LLM Provider များ — Cloud vs Local | 🟢 |
| **L2** | LangChain ChatOpenAI/ChatOllama interface | 🟡 |
| **L3** | Streaming + Usage tracking | 🟡 |
| **L4** | Failover Pattern (try/except chain) | 🔴 |
| **L5** | Config Precedence (DB > env > default) | 🔴 |

---

# Lesson 1 — Cloud vs Local LLM

| | Cloud (OpenRouter/H-Chat) | Local (Ollama) |
|---|---|---|
| **Quality** | Best (GLM, Claude, GPT-class) | ကောင်း (llama3.2:3b) |
| **Latency** | 5–20s | 60s–8min (CPU) |
| **Cost** | Pay per token | Free (on-prem) |
| **Internet** | လိုအပ်သည် | မလို (air-gap safe) |
| **Control** | Provider လက်ထဲ | လုံးဝ ကိုယ်ပိုင် |

**ဒါကြောင့် dual setup** —
- ပုံမှန်လည်ပတ်မှု — **cloud** (quality + speed)
- **Cloud ပျက်လျှင်** — Ollama fallback (service availability)
- **Air-gap mode** — local only (cost control / offline)

---

# Lesson 2 — LangChain Interface

```python
# Cloud — OpenAI-compatible endpoint (OpenRouter က ဒီ protocol ကို လိုက်နာသည်)
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="z-ai/glm-5.3-flash",
    api_key="sk-or-...",                # OpenRouter key
    base_url="https://openrouter.ai/api/v1",
    streaming=True,                      # tokens တွေ တစ်လုံးချင်း ရမယ်
    max_tokens=4096,                     # output cap
    temperature=0.4,                     # 0 = deterministic, 1 = creative
    timeout=15.0,                        # fail-fast ကို fallback ခေါ်ရန်
    stream_usage=True,                   # final chunk မှာ usage ပါမယ်
)

# Local — on-prem Ollama
from langchain_ollama import ChatOllama
fb = ChatOllama(
    model="llama3.2:3b",
    base_url="http://ollama:11434",
    streaming=True,
    temperature=0.1,                     # deterministic-ish
    num_predict=4096,                    # output cap (v1.6.29)
    num_ctx=4096,                        # KV cache context window
)
```

---

# Lesson 3 — Streaming + Usage Tracking

```python
def _stream_with_usage(llm, question, context):
    """Yield (token, usage) pairs — usage on LAST zero-token pair."""
    prompt = ChatPromptTemplate.from_messages([
        ("system", _SYSTEM_PROMPT),
        ("human", f"Context:\n{context}\n\nQuestion: {question}"),
    ])
    for chunk in llm.stream(prompt):
        usage = None
        if hasattr(chunk, "usage_metadata") and chunk.usage_metadata:
            um = chunk.usage_metadata
            usage = {"input_tokens": um.get("input_tokens", 0),
                     "output_tokens": um.get("output_tokens", 0),
                     "total_tokens": um.get("total_tokens", 0)}
        yield (chunk.content or "", usage)
```

**Usage** — token cost ကို monitor လုပ်ဖို့ (billing dashboard မှာ ပြမယ်)။

---

# Lesson 4 — Failover Pattern ⭐

```python
def stream_answer(question, context, llm_provider=None):
    """Cloud → local → dev mock chain. Never raises."""
    want = (llm_provider or "auto").lower()

    # === Forced local mode (user chose "Local only") ===
    if want == "local":
        fb = _build_local_ollama()
        if len(context) > 4000:
            context = context[:4000] + "\n[truncated for local model]"
        yield from _stream_with_usage(fb, question, context)
        return

    # === Primary (cloud) ===
    llm = make_llm()
    if llm is not None:
        try:
            yield from _stream_with_usage(llm, question, context)
            return
        except Exception as e:
            logger.warning(f"primary failed: {e}")
            if want == "cloud":
                # Cloud-forced — do NOT silently degrade to local
                for tok in DEV_MOCK: yield tok, None
                return

    # === Fallback (local) ===
    if SETTINGS.fallback_enabled:
        fb = _build_local_ollama()
        context = context[:4000]
        yield from _stream_with_usage(fb, question, context)
```

**v1.6.22 modes:**
- `"auto"` — cloud → local → dev mock (default)
- `"cloud"` — cloud ပဲ (ပျက်ရင် mock — Ollama မခေါ်ဘူး)
- `"local"` — local ပဲ (cloud လုံးဝ မခေါ်ဘူး)

## 🔧 Lab 8.1 — Failover Live Test

```bash
unset KUBECONFIG

# 1. Normal — cloud answer
# 2. Kill OpenRouter key
kubectl -n rag-chatbot set env deploy/backend OPENAI_API_KEY=invalid
kubectl -n rag-chatbot rollout restart deploy/backend
kubectl -n rag-chatbot rollout status deploy/backend

# 3. Same question → llama3.2:3b answer (model တိုက်စစ်)
kubectl -n rag-chatbot logs deploy/backend --since=5m | grep -i "local fallback"

# 4. Restore
kubectl -n rag-chatbot set env deploy/backend OPENAI_API_KEY=<real-key>
```

---

# Lesson 5 — Config Precedence

```python
# 1) DB `system_settings['llm']` (Settings UI hot-change, 30s TTL cache)
# 2) env `SETTINGS` (.env / K8s ConfigMap)
# 3) code default

def _cfg(key: str, default: str) -> str:
    """DB value if set, else env SETTINGS, else code default."""
    db_val = _get_db_config(key)         # from system_settings
    return db_val or default
```

**ဘာလို့ ဒီလို layered?** — OpenRouter key ပြောင်းလျှင် **app restart မလိုဘူး** —
Settings UI မှာ ပြင်လျှင် ချက်ချင်း အလုပ်လုပ်သည် (30s TTL cache ကြောင့်)။

## 🔧 Lab 8.2 — Config Hot-Change Test

```bash
# Settings UI မှာ model ပြောင်း (ဥပမာ — minimax → glm-5.3-flash)
# 30 စက္ကန့် စောင့်ပြီး — get_active_model_name() နဲ့ စစ်

kubectl -n rag-chatbot exec deploy/backend -- python -c "
from app.llm.client import get_active_model_name
print('active model:', get_active_model_name())
" 2>&1 | grep -v openbao
```

---

# ✅ Self-Check (M8)

1. Cloud vs Local LLM — အားသာချက် ၃ ခုစီ ပြပါ။
2. `timeout=15.0` + `max_retries=1` က ဘာလို့ အရေးကြီးလဲ?
3. Streaming ထဲမှာ provider error ကို ဘယ်လို ဖမ်းရမလဲ?
4. `num_predict` နဲ့ `num_ctx` ကွာပုံက ဘာလဲ? Memory မှာ ဘယ်ဟာက သက်ရောက်လဲ?
5. Settings UI ကနေ LLM config ပြောင်းလျှင် app restart မလုပ်ရဘူးဆိုတာ ဘာလို့လဲ?

---

> **နောက်တစ်ဆင့်** — M9 (Security) ကို ဆက်လေ့လာပါ။
> LLM အပေါ်ကို ထိုးနှံနိုင်မှု (prompt injection) ကာကွယ်ဖို့။