## 🔧 Tutorial 2.1 — Mini FastAPI SSE Server

ဒီ tutorial က အရင်ဆုံး **lab folder** မှာ sandbox ဆောက်ပြီး လုပ်ပါ။

```bash
# === Lab folder ဆောက် ===
mkdir ~/ragchatbot-labs && cd ~/ragchatbot-labs
uv venv && uv pip install fastapi uvicorn pydantic

# mini_server.py ဖန်တီး
cat > mini_server.py <<'PYEOF'
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import json, asyncio

app = FastAPI()

def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"

@app.post("/api/chat/stream")
async def stream():
    async def gen():
        # Simulate RAG pipeline stages
        yield sse("stage", {"stage": "understanding"})
        await asyncio.sleep(1)
        yield sse("stage", {"stage": "retrieving"})
        await asyncio.sleep(1)
        yield sse("meta", {"confidence": 0.82, "decision": "answer"})
        for tok in ["RAG ", "Pipeline ", "is ", "working."]:
            await asyncio.sleep(0.2)
            yield sse("token", {"token": tok})
        yield sse("done", {"latency_ms": 3200})
    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"}
    )
PYEOF

# Run
uv run uvicorn mini_server:app --port 8001 &

# Test with curl
curl -N -X POST http://127.0.0.1:8001/api/chat/stream \
  -H "Content-Type: application/json" -d '{"message":"hi"}'
```

**ကြိုးစားစရာ** — `X-Accel-Buffering: no` ကို ဖယ်ပြီး run ကြည့်ပါ — nginx proxy နောက်ကွယ်မှာ
SSE buffer ဖြစ်နေတတ်သည်။ (ဒါက Real project မှာ ကြုံခဲ့တဲ့ bug)

## 🔧 Tutorial 2.2 — Real Project ကို ကိုယ်တိုင် trace လုပ်

```bash
# Production cluster ထဲက backend ရဲ့ lifespan ကို လေ့လာမယ်
kubectl -n rag-chatbot logs deploy/backend | grep -iE "init_db|telemetry|started"

# တစ်ကြိမ် request ပို့ပြီး SSE event တွေ အစဉ်လိုက် ကြည့်
# (ခဏစောင့်ရမယ် — login + stream)
```

