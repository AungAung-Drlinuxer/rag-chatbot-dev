# M2 — FastAPI Crash Course (စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — FastAPI ဘာမှ မသိသေးသည့် အခြေအနေမှ စတင်၍၊ ဒီ project ၏
> `backend/app/main.py`, `api/*.py`, `config.py` ဖိုင်များကို နားလည်စွာ ဖတ်နိုင်ရန်
> **Essential (မသိမဖြစ်)** အခြေခံများကို မြန်မာလို အသေးစိတ် သင်ကြားပေးထားခြင်း ဖြစ်ပါသည်။
>
> **စဉ်ဆက်မပြတ် ဖွဲ့စည်းပုံ** — Lesson 1–7 (Essential Theory + Code) → Labs 1–5 (ကိုယ်တိုင်လုပ်) →
> Final Project (Mini RAG API) → Self-Check

---

## 📚 ဒီ Series မှာ ဘာတွေ သင်မယ်

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | Python Environment + uv (FastAPI run လုပ်ဖို့ အခြေခံ) | 🟢 |
| **L2** | First FastAPI App — `@app.get` / Path / Query / Body | 🟢 |
| **L3** | Pydantic — Request/Response models + validation | 🟢 |
| **L4** | APIRouter — Route များကို file များအလိုက် ခွဲရေး | 🟡 |
| **L5** | Dependency Injection (`Depends`) — auth, DB session | 🟡 |
| **L6** | Lifespan — startup/shutdown events | 🟡 |
| **L7** | StreamingResponse + SSE (chatbot ရဲ့ အသည်းနှလုံး) | 🔴 |
| **Lab** | Mini RAG-style API — အပေါ်ပိုင်း အားလုံး ပေါင်းကူးလုပ်ခြင်း | 🔴 |

---

# Lesson 1 — Python Environment + uv

## သီအိုရီ

Python project တစ်ခုမှာ dependency များကို **isolated environment** ထဲ ထားရမည် —
system Python နဲ့ ရောမသွန်းရ (မဟုတ်ရင် တခြား project ပျက်မယ်)။

**uv** က pip/venv/pip-tools ကို အစားထိုးသည့် ခေတ်သစ် manager ဖြစ်သည် — မြန်ပြီး lockfile ရှိသည်။

## Code

```bash
# uv install (Windows PowerShell)
irm https://astral.sh/uv/install.ps1 | iex

# Project setup
uv venv                  # .venv/ folder ဖန်တီး
uv pip install fastapi uvicorn pydantic pydantic-settings
```

**ဘာလို့ uv သုံးလဲ (pip ထက်):**
1. Rust နဲ့ ရေးထားလို 10x မြန်သည်
2. `pyproject.toml` + `uv.lock` — dependency version များ **exact-pin** ဖြစ်သည် (team အားလုံး တူညီမယ်)
3. Project အားလုံးက `uv sync` တစ်ခုတည်းနဲ့ install လုပ်လို့ရသည်

## ⚠️ မမေ့ရမည့်အချက်

Windows မှာ Python ကို **`python`** (မဟုတ် `python3`) လို့ ခေါ်ရသည်။
မင်းရဲ့ machine ထဲ Python 3.12 ရှိပြီးသား။

---

# Lesson 2 — First FastAPI Server

## သီအိုရီ

FastAPI က **Python မှာ API ရေးတဲ့ framework** — async support, auto docs (Swagger UI),
type-checking တွေ ပါဝင်သည်။

```python
from fastapi import FastAPI

app = FastAPI(title="My First API")

# GET = အချက်အလက် ဖတ်ရန်
@app.get("/")
def root():
    return {"message": "Hello"}

@app.get("/items/{item_id}")            # Path parameter
def get_item(item_id: int, q: str = None):   # Query parameter `?q=...`
    return {"item_id": item_id, "q": q}
```

**Run:**
```bash
uvicorn main:app --reload --port 8000
# --reload: code ပြင်လျှင် auto restart (dev only!)
# Swagger UI: http://127.0.0.1:8000/docs — auto-generated interactive docs!
```

## HTTP Method များ (REST API အခြေခံ)

| Method | အဓိပ္ပာယ် | ဥပမာ |
|---|---|---|
| `GET` | အချက်အလက် **ရယူ** | `GET /api/tickets` — ticket အားလုံး ကြည့် |
| **POST** | **အသစ် ဖန်တီး** | `POST /api/tickets` — ticket အသစ် ဖန်တီး |
| **PUT/PATCH** | **ပြင်ဆင်** | `PUT /api/tickets/ITHD-5` |
| **DELETE** | **ဖျက်** | `DELETE /api/tickets/ITHD-5` |

**Status Code များ (မှတ်ထားရမည်):**
```
200 OK           → အောင်မြင်
201 Created      → POST မှာ အသစ် ဖန်တီးပြီး
400 Bad Request  → client မှားပို့
401 Unauthorized → auth မရှိ
403 Forbidden    → auth ရှိပေမယ့် permission မရှိ
404 Not Found    → ရှာမတွေ့
422 Unprocessable→ request body format မှား (pydantic validation fail)
500 Internal     → server code error
429 Too Many     → rate limit
```

---

# Lesson 3 — Pydantic (Request/Response Validation)

FastAPI ရဲ့ **မှားမရနိုင်တဲ့ အားသာချက်** — Pydantic model သုံးပြီး request body
ကို **automatic validate** လုပ်ပေးသည်။

```python
from pydantic import BaseModel, Field, ConfigDict

class TicketCreate(BaseModel):
    subject: str                    # required
    priority: str = "medium"        # default value
    description: str | None = None  # optional

    # Strict mode — unknown field တွေ ပါလာရင် 422 ဖြတ်သည်
    # (typo/extra field များ silent-ignore မလုပ်ရန် — security)
    model_config = ConfigDict(extra="forbid")

@app.post("/tickets")
def create_ticket(t: TicketCreate):
    # t ကို pydantic က validate လုပ်ပြီးသား — subject က string ဖြစ်နေမယ်
    return {"created": t.subject}
```

**Client က မှားပို့ရင် ဘာဖြစ်မလဲ:**
```json
// Request: {"subj": "x"} (subject မှားရေး)
// Response: 422 with detailed error — field name + reason အပြည့်အစုံ
```

**ဒါက project ၏ `schemas.py` မှာ အသုံးပြုထားပုံ:**
```python
class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")   # စည်းကမ်း #2

class ChatRequest(StrictModel):
    message: str
    session_id: str | None = None
    llm_provider: str | None = None             # "auto"|"cloud"|"local"
```

---

# Lesson 4 — APIRouter (Route များကို ခွဲရေး)

Project ကြီးလာရင် `main.py` ထဲ endpoint များအကုန် မထားသင့်ဘူး — **feature အလိုက်
file ခွဲရမယ်**။

```python
# api/tickets.py
from fastapi import APIRouter

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

@router.get("/")          # GET /api/tickets
def list_tickets(): ...

@router.post("")          # POST /api/tickets
def create_ticket(...): ...

@router.get("/{ref}")     # GET /api/tickets/ITHD-5
def get_ticket(ref: str): ...
```

```python
# main.py — အားလုံးစုဝေး
from fastapi import FastAPI
from api.tickets import router as tickets_router
from api.auth import router as auth_router

app = FastAPI()
app.include_router(tickets_router)
app.include_router(auth_router)
```

**ရှင်းလင်းချက်** — ဒီ project မှာ `api/` folder ထဲ router ၁၂ ခုရှိသည် —
တစ်ခုချင်းစီက feature တစ်ခုစီ (tickets, chat, users...) ကို ကိုယ်စားပြသည်။

---

# Lesson 5 — Dependency Injection (`Depends`)

**အသုံးနှုန်း** — တစ် endpoint ချင်းစီမှာ **ထပ်ခါထပ်ခါ လုပ်ရမည့် အလုပ်များ**
(auth check, DB session open, ...) ကို function တစ်ခုအနေနဲ့ ထုတ်ပြီး
**endpoint များမှာ `Depends()` နဲ့ ခေါ်ရသည်**။

```python
from fastapi import Depends, HTTPException

# Dependency — token ကို စစ်ပြီး username ပြန်ပေး
def get_current_user(authorization: str = ""):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, SECRET, ["HS256"])
        return payload["sub"]          # username
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "token expired")

# Endpoint — dependency ကို declare
@app.get("/api/me")
def me(user: str = Depends(get_current_user)):
    return {"username": user}
```

**ဘာလို့ အသုံးဝင်လဲ:**
1. စစ်ဆေးမှု logic ကို **တစ်နေရာတည်း** ရေး (DRY)
2. Test လုပ်ရလွယ် — `Depends` ကို mock လုပ်လို့ရ
3. **OpenAPI docs** ထဲ အလိုအလျောက် security scheme ပါမယ်

**ဒီ project မှာ:**
```python
# app/api/chat.py
def chat_stream(req: ChatRequest, user: str = Depends(_require_chatbot)):
    # _require_chatbot က RBAC "chatbot" capability check လုပ်ပြီးမှ
    # stream လုပ်ပေးသည် (user role ဆို ခွင့်ပြုမည်)
```

---

# Lesson 6 — Lifespan (startup/shutdown)

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # === STARTUP (server စတင်ချိန်၊ တစ်ကြိမ်တည်း) ===
    init_db()           # database tables create (idempotent — ရှိပြီးရင် skip)
    setup_telemetry()   # OpenTelemetry (best-effort — ပျက်ရင် မထ)
    yield               # ← app က ဒီထက်နေမယ် — request များ လက်ခံမယ်
    # === SHUTDOWN (server ပိတ်ချိန်) ===
    # cleanup — connection pool close, background task cancel...

app = FastAPI(lifespan=lifespan)
```

**မှတ်ထားရမည့် စည်းကမ်းများ:**
1. Startup မှာ **fail-fast မလုပ်ရ** (DB down ဖြစ်နေလျှင်လည်း server တက်နေသင့် —
   request တွေ လာတဲ့အခါမှ 403/503 ပြန်မယ်)
2. Telemetry ပျက်လျှင်လည်း app **တက်ရမယ်** — "best-effort"
3. Shutdown မှာ resource များ ပြန်ပိတ် (DB engine.dispose(), Redis client.close())

---

# Lesson 7 — StreamingResponse + SSE ⭐ (အရေးကြီးဆုံး)

Chatbot က အဖြေကို **စကားလုံးလိုက် stream** လုပ်ပြပေးသည် (ChatGPT လို)။
ဒါကို အကောင်အထည်ဖော်တာက **SSE (Server-Sent Events)** ဖြစ်သည်။

## SSE format (server → client)

```
event: token
data: {"token": "Hello"}

event: token
data: {"token": " world"}

event: done
data: {"latency_ms": 15432}
```

**Format Rules:**
- တစ် event ကို `event: <name>\ndata: <json>\n\n` — **double newline** နဲ့ အဆုံးသတ်ရမယ်
- Stream ကို `text/event-stream` media type နဲ့ ပြန်ရမယ်
- `X-Accel-Buffering: no` header — nginx proxy နောက်ကွယ်မှာ buffer မလုပ်စေရန်

## Code — Complete SSE Endpoint

```python
import json, asyncio
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

app = FastAPI()

def sse(event: str, data: dict) -> str:
    """One SSE event as a string."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

@app.post("/api/chat/stream")
async def chat_stream():
    async def gen():
        # Stage event — UI ကို "processing" ပြပါမယ်
        yield sse("stage", {"stage": "understanding"})
        await asyncio.sleep(1)

        yield sse("stage", {"stage": "retrieving"})
        await asyncio.sleep(1)

        # Token events — chat bubble တစ်လုံးချင်း တိုးတယ်
        for tok in ["To ", "restart ", "nginx,", " run ", "sudo systemctl"]:
            await asyncio.sleep(0.2)
            yield sse("token", {"token": tok})

        yield sse("done", {"latency_ms": 2100})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",   # nginx buffering off
            "Cache-Control": "no-cache",
        },
    )
```

## Client ဘက် (TypeScript — project ၏ `useChatStream.ts`)

```typescript
const res = await fetch("/api/chat/stream", { method: "POST", ... });
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  // ⚠️ network packet က full event တစ်ခါတည်း မပို့ဘူး — partial chunk တွေ ရနိုင်
  const parts = buffer.split("\n\n");      // events separated by \n\n
  buffer = parts.pop() ?? "";              // last partial → next read ကို စောင့်

  for (const block of parts) {
    const ev = /event: (\w+)/.exec(block)?.[1];
    const data = JSON.parse(/data: (.*)/.exec(block)![1]);
    if (ev === "token") appendToBubble(data.token);
    if (ev === "stage") updateTracker(data);
  }
}
```

## ⚠️ Gotchas (ကျွန်တော်တို့ တွေ့ခဲ့ဖူးတဲ့ ပြဿနာများ)

1. **SSE generator ထဲ exception မထုတ်ရ** — ထွက်လျှင် client မှာ stream ချက်ချင်း ပြတ်မယ်
   → try/except နဲ့ graceful fallback ထည့်ပါ (ဥပမာ — LLM provider error → local model)
2. **nginx proxy_buffering ပိတ်ရမယ်** — `proxy_buffering: "off"` + `X-Accel-Buffering: no`
   မလုပ်ရင် client က tokens မြင်ရမယ့်အစား အားလုံး တစ်ခါတည်း ရောက်လာမယ်
3. **EventSource မသုံးရ** — browser API က Authorization header မထည့်နိုင်ဘူး
   → `fetch` + `ReadableStream` ကို ကိုယ်တိုင် ရေးရမယ် (project ရဲ့ `useChatStream.ts`)

---

# 🧪 Lab 1 — Mini API (အခြေခံ)

**အနှစ်သာရ:** Lesson 1-5 အရ — login + JWT + tickets CRUD လုပ်နိုင်တဲ့ mini API

```bash
mkdir ~/m2-lab && cd ~/m2-lab
uv venv && uv pip install fastapi uvicorn pydantic pydantic-settings python-jose[cryptography]
```

**main.py:**
```python
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
import jwt, time

SECRET = "lab-secret"
app = FastAPI(title="M2 Lab API")

# --- Models (Lesson 3) ---
class LoginReq(BaseModel):
    username: str
    password: str

class Ticket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    subject: str
    status: str = "open"

DB: dict[str, dict] = {}   # in-memory "database"

# --- Auth (Lesson 5) ---
def get_user(authorization: str = ""):
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    try:
        return jwt.decode(authorization[7:], SECRET, ["HS256"])["sub"]
    except Exception:
        raise HTTPException(401, "invalid token")

# --- Endpoints (Lesson 2, 4) ---
@app.post("/auth/login")
def login(r: LoginReq):
    if r.username == "dev" and r.password == "dev":
        return {"access_token": jwt.encode(
            {"sub": "dev", "exp": int(time.time()) + 1800}, SECRET, "HS256")}
    raise HTTPException(401, "bad credentials")

@app.get("/tickets")
def list_tickets(user: str = Depends(get_user)):
    return list(DB.values())

@app.post("/tickets", status_code=201)
def create_ticket(t: Ticket, user: str = Depends(get_user)):
    DB[t.id] = t.model_dump()
    return DB[t.id]
```

**Test sequence:**
```bash
uvicorn main:app --port 8001 &
TOKEN=$(curl -s -X POST http://127.0.0.1:8001/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"dev","password":"dev"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl http://127.0.0.1:8001/tickets -H "Authorization: Bearer $TOKEN"
# → [] (empty list)

curl -X POST http://127.0.0.1:8001/tickets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"id":"T-1","subject":"VPN broken","priority":"high"}'
# → {"id":"T-1","subject":"VPN broken","status":"medium"} (created!)

# 401 test — token မပါ
curl http://127.0.0.1:8001/tickets -o /dev/null -w "%{http_code}\n"
# → 401
```

---

# 🧪 Lab 2 — SSE Streaming (Lesson 7 ကို လက်တွေ့စမ်း)

`mini_server.py` ထဲ ထပ်ထည့်:

```python
@app.post("/chat/stream")
async def chat_stream():
    async def gen():
        for stage in ["understanding", "rewrite", "retrieve"]:
            yield sse("stage", {"stage": stage, "detail": f"Running {stage}"})
            await asyncio.sleep(0.5)
        for tok in ["The ", "answer ", "is ", "42."]:
            yield sse("token", {"token": tok})
            await asyncio.sleep(0.2)
        yield sse("done", {"latency_ms": 2500})
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no"})

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"
```

**curl -N နဲ့ ကြည့်** (-N = no buffer):
```bash
curl -N -X POST http://127.0.0.1:8000/chat/stream
# ကြည့်ရ — events တွေ တစ်ခုချင်း ထွက်လာတာ တွေ့မယ်
```

---

# 🧪 Lab 3 — Real Project Trace (Live Cluster)

ဒီ lab မှာ production cluster ထဲမှာပဲ စစ်မယ်:

```bash
unset KUBECONFIG

# 1. main.py ရဲ့ lifespan က ဘာတွေ လုပ်နေလဲ — logs မှာ ကြည့်
kubectl -n rag-chatbot logs deploy/backend --since=10m | head -10
# Expect: "init_db complete", "telemetry initialized", Uvicorn running

# 2. /health endpoint နဲ့ live check
kubectl -n rag-chatbot get svc backend
curl -sk https://chat.drlinuxer.com/health
# → {"status": "ok"}

# 3. OpenAPI docs ကို ကိုယ်တိုင် ကြည့်
kubectl -n rag-chatbot port-forward deploy/backend 8000:8000 &
# Browser → http://localhost:8000/docs
# ဒါက FastAPI auto-generated Swagger UI — endpoint အားလုံး မြင်ရမယ်

# 4. chat endpoint ထဲက SSE events တွေ ကိုယ်တိုင် ကြည့်
kubectl -n rag-chatbot exec deploy/backend -- python -c "
import urllib.request, json
# login + POST /api/chat/stream + print events
"
```

---

# 🎓 Capstone — Mini RAG API သုညမှ

အပေါ်က lessons အားလုံးကို ပေါင်းပြီး ကိုယ်ပိုင် mini-RAG API တစ်ခု တည်ဆောက်ပါ:

```
Requirements:
1. POST /auth/login — username/password → JWT (Lesson 5)
2. GET /health — 200 OK (Lesson 2)
3. POST /kb/articles — title + body သိမ်း (in-memory dict) (Lesson 3)
4. POST /api/chat/stream — SSE endpoint ထဲမှာ:
   a. yield stage event ("understanding")
   b. kb ထဲကနေ keyword တိုက်ဆိုင်ပြီး relevant article ရှာ
   c. yield token* events (fake LLM — context ထဲက စာကို စုတ်ပြီး ခွဲပြီး ထုတ်)
   d. yield done event with latency_ms
5. Unauthorized request → 401 (Lesson 5)

Success Criteria:
- curl နဲ့ login → token → kb POST → chat stream အားလုံး အလုပ်လုပ်ရမယ်
- swagger /docs ထဲ အကုန် ပြရမယ်
```

**အချိန်ခန့်မှန်း** — ၁–၂ နာရီ။ ပြီးရင် `docs/course/M2-fastapi-core/capstone-solution.md` နဲ့ တိုက်စစ်ပါ။

---

# ✅ Self-Check (M2 Master Quiz)

1. `APIRouter` နဲ့ plain `app.get()` ကွာပုံက ဘာလဲ? Feature ၁၅ ခု ရှိရင် ဘာလို့ router သုံးရမလဲ?
2. `model_config = ConfigDict(extra="forbid")` က ဘာကာကွယ်ပေးလဲ? (security context)
3. SSE မှာ `\n\n` (double newline) ဘာလို့ အရေးကြီးလဲ? မပါရင် ဘာဖြစ်မလဲ?
4. `Depends()` က ဘာလို့ OpenAPI docs အတွက်လည်း အထောက်အကူ ဖြစ်စေလဲ?
5. `lifespan` ထဲမှာ DB မရှိလျှင် app က လုံးဝ မတက်သင့်လား? ဘာလို့လဲ?
6. nginx နောက်ကွယ်မှာ SSE လုပ်ရင် `X-Accel-Buffering: no` header ဘာလို့ လိုသလဲ?
7. `EventSource` နဲ့ `fetch + ReadableStream` — ဘာလို့ ဒီ project က နောက်တမ်း ရွေးထားလဲ?

---

> **နောက်တစ်ဆင့်** — M3 (PostgreSQL + pgvector) folder ကို ဆက်လေ့လာပါ။
> ဒီ M2 skills တွေက FastAPI ကို ပြည့်ပြည့်စုံစုံ သုံးဖို့ အခြေခံပဲ ဖြစ်သည်။
> **ဆက်စပ်ဖတ်ရန်** — `01-explanation.md` (lifespan, router, pydantic, SSE နှင့် project ၏ code map)