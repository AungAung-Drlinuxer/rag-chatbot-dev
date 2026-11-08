# M2 — Backend FastAPI Core

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Lifespan Pattern ဆိုတာ

FastAPI application တစ်ခုမှာ **startup** နှင့် **shutdown** အချိန်များမှာ
တစ်ကြိမ်တည်း လုပ်ဆောင်ရမည့် အလုပ်များကို `lifespan` context manager ထဲ ထားသည်။

```python
# လက်တွေ့ pattern ကို ကြည့်ပါ
@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()           # ① database tables + vector extension ဖန်တီး
    setup_telemetry()   # ② OpenTelemetry metrics + traces စတင်
    # ③ reranker preload (CPU mode သာ)
    yield               # ← application run နေတဲ့အထိ ဒီမှာနေမယ်
    # (shutdown လုပ်ချင်တာ ဒီထက်ပိုတင်နိုင်)
```

**Beneath the hood:**
- အကယ်၍ app boot လုပ်တဲ့အခါ DB schema မရှိသေးရင် — `init_db()` က **automatic** ဖန်တီးပေးမယ်
- Telemetry က **best-effort** ဖြစ်သည် — LGTM stack မရှိလျှင် လုံးဝ ချိုးဖျက်မနေရ
- Startup မှာ `reranker` ကို preload လုပ် (CPU မှာ pytorch model ကို မီးရှို့လိုက်တာ)

### Router-per-Domain Pattern

```
backend/app/api/
├── auth.py         → POST /api/auth/login
├── chat.py         → POST /api/chat/stream (SSE)
├── tickets.py      → GET /api/tickets, POST /api/tickets, /api/domains
├── knowledge.py    → KB articles CRUD
├── admin.py        → classifier_domains CRUD
├── users.py        → RBAC user management
├── settings.py     → integration config (Jira/Confluence/LLM keys)
└── health.py       → GET /health
```

တစ်ခုချင်းစီက **`APIRouter`** object ဖြစ်ပြီး `main.py` မှာ တစ်ကြိမ် include လုပ်သည်။
**ရှင်းလင်းချက်** — code file တစ်ဖိုင်စီတွင် endpoint များ စုဝေးနေလို့ — **maintain** ရလွယ်သည်။

### pydantic-settings — Type-Safe Config

```python
# app/config.py — pattern
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql://..."
    redis_url: str = "redis://..."
    openai_api_key: str = ""
    chat_model: str = "z-ai/glm-5.3-flash"
    embed_model: str = "nomic-embed-text"
    fallback_enabled: bool = True

    class Config:
        env_file = ".env"

SETTINGS = Settings()   # singleton
```

**Code ထဲက ခေါ်နည်း** — `SETTINGS.database_url` လို့ တိုက်ရိုက်ရ — `.env` file က env ကနေ အလိုအလျောက် load

### SSE (Server-Sent Events) ကို FastAPI မှာ ရေးနည်း

```python
# SSE က **one-way streaming** (server → client) ပါ။  HTTP/2 မလို၊ WebSocket မလို။
def sse(event: str, data: dict) -> str:
    """SSE event format — double newline နဲ့ အဆုံးသတ်ရမယ်!"""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

# Client ဘက်မှာ:
#   event: token
#   data: {"token": "Hello"}
#
# event: token
# data: {"token": " world"}
```

**⚠️ Sensitive Rule:** SSE generator ထဲမှာ **unhandled exception မထုတ်ရဘူး** —
exception ထွက်လျှင် client side မှာ stream က ချက်ချင်း ပြတ်သွားမယ်။
ဒါကြောင့် **try/except** ကို အမြဲထည့်ပြီး graceful degrade လုပ်ရမယ်။

