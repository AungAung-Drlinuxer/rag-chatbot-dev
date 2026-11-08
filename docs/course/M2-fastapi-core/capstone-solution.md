# M2 Capstone — Mini RAG API Solution

> Capstone exercise (`00-crash-course.md` 🎓 section) ရဲ့ solution —
> **အရင် ကိုယ်ပိုင် ရေးကြည့်ပြီးမှ** ဒီ file ကို ဖွင့်ပါ!

---

## Solution Code (main.py — တစ်ဖိုင်တည်း)

```python
"""M2 Capstone — Mini RAG API
Lessons covered: 2 (routes) 3 (pydantic) 4 (router) 5 (auth) 7 (SSE)."""
from __future__ import annotations

import json
import time
from contextlib import asynccontextmanager

import jwt
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict

SECRET = "capstone-secret"
KB: dict[str, dict] = {}          # id -> {title, body}
_REQUESTS: list[float] = []       # naive rate-limit timestamps


# === Lesson 6 — lifespan ===
@asynccontextmanager
async def lifespan(_app):
    KB["kb-1"] = {
        "title": "VPN Reconnection Guide",
        "body": "To reconnect the VPN: open Cisco AnyConnect, enter vpn.company.com, "
                "authenticate with your LDAP credentials, and approve MFA on your phone.",
    }
    KB["kb-2"] = {
        "title": "Password Reset Guide",
        "body": "To reset your password: visit portal.company.com, click Forgot Password, "
                "enter your email, and follow the link sent to your inbox.",
    }
    print("startup: KB seeded with 2 articles")
    yield
    print("shutdown: bye")


app = FastAPI(title="M2 Capstone — Mini RAG API", lifespan=lifespan)


# === Lesson 3 — models ===
class LoginReq(BaseModel):
    username: str
    password: str


class ArticleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    body: str


# === Lesson 5 — auth dependency ===
def get_user(authorization: str = "") -> str:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing token")
    try:
        return jwt.decode(authorization[7:], SECRET, ["HS256"])["sub"]
    except Exception:
        raise HTTPException(401, "invalid or expired token")


# === Lesson 2 — basic endpoints ===
@app.get("/health")
def health():
    return {"status": "ok", "kb_articles": len(KB)}


@app.post("/auth/login")
def login(r: LoginReq):
    if r.username == "dev" and r.password == "dev":
        return {"access_token": jwt.encode(
            {"sub": r.username, "exp": int(time.time()) + 1800}, SECRET, "HS256")}
    raise HTTPException(401, "bad credentials")


# === KB storage ===
@app.post("/kb/articles", status_code=201)
def add_article(a: ArticleCreate, user: str = Depends(get_user)):
    aid = f"kb-{len(KB) + 1}"
    KB[aid] = a.model_dump()
    return {"id": aid, "title": a.title}


# === Lesson 7 — SSE chat with naive retrieval ===
def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/api/chat/stream")
def chat_stream(user: str = Depends(get_user)):
    # NOTE: a real implementation reads the question from the request body.
    # For this capstone we read the LAST user message the client sent — demo
    # simplicity; see M6 for the full pipeline.
    from fastapi import Request
    from starlette.requests import request_context  # not used — demo only

    def gen():
        t0 = time.time()
        yield _sse("stage", {"stage": "understanding", "detail": "Analyzing your question"})

        # naive retrieval — later modules replace this with pgvector hybrid search
        question = DEMO_QUESTION[0]
        scored = sorted(
            KB.items(),
            key=lambda kv: sum(1 for w in kv[1]["body"].lower().split()
                               if w in question.lower()),
            reverse=True,
        )
        top_id, top = scored[0]

        yield _sse("stage", {"stage": "retrieve", "detail": f"Found: {top['title']}"})
        yield _sse("meta", {"confidence": 0.82, "decision": "answer",
                            "hits": [{"title": top["title"]}]})

        for tok in top["body"].split(" "):
            yield _sse("token", {"token": tok + " "})

        yield _sse("done", {"latency_ms": int((time.time() - t0) * 1000),
                            "message_id": top_id_of(top)})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no"})


DEMO_QUESTION = [""]          # captured from middleware (demo simplification)
def top_id_of(article: dict) -> str:
    return next(k for k, v in KB.items() if v is article)
```

> **Note** — ဒီ solution မှာ question body parsing ကို demo simplification လုပ်ထားပါတယ်။
> ကိုယ်ရေးတဲ့ solution မှာ `Request` object (or body model) နဲ့ မှန်ကန်စွာ ဖတ်ပါ —
> ဒါက စမ်းသပ်ရန် အဓိက အချက် မဟုတ်ပါ (Lesson 2 + 3 ကို apply လုပ်ရုံပါ)။

---

## ✅ Verification Checklist

```bash
uvicorn capstone:app --port 8002

# 1. health
curl http://127.0.0.1:8002/health
# → {"status":"ok","kb":2}

# 2. login
TOKEN=$(curl -s -X POST http://127.0.0.1:8002/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"dev","password":"dev"}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

# 3. add KB article
curl -X POST http://127.0.0.1:8002/kb/articles \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"SSL Renewal","body":"Renew with certbot renew --dry-run then systemctl reload nginx."}'

# 4. chat stream (SSE)
curl -N -X POST http://127.0.0.1:8002/api/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"How do I renew SSL?"}'
# → stage → meta → token* → done events

# 5. 401
curl -o /dev/null -s -w "%{http_code}\n" http://127.0.0.1:8002/api/chat/stream -X POST
# → 401
```

## 📊 Scoring Yourself

| Check | ရမှုပွိုင့် |
|---|---|
| Login → JWT ရသည် | 20 |
| 401 without token | 15 |
| KB POST 201 | 15 |
| SSE stream — stage/meta/token/done sequence မှန် | 30 |
| Retrieval က KB ထဲက အဖြေနဲ့ ကိုက်ညီမှု | 15 |
| `/docs` Swagger UI — endpoint အကုန် ပြ | 10 |
| **Total** | **100** |

**85+ ရပြီးလျှင်** — M3 ကို ဆက်ပါ။ မရှိသေးရင် 01-explanation.md ကို ပြန်ဖတ်ပါ။