# M1 — Lab Setup Crash Course (အခြေခံမှ စတင်လေ့လာမည့်သူများအတွက်)

> **ရည်ရွယ်ချက်** — Environment setup ကို လုံးဝ အသစ် စတင်သူများအတွက် —
> Tools install လုပ်ခြင်း၊ first server run လုပ်ခြင်း၊ KB ingestion စမ်းခြင်း။

---

## 📚 Lessons

| Lesson | ခေါင်းစဉ် | Level |
|---|---|---|
| **L1** | Tools List + Installation Order | 🟢 |
| **L2** | uv + Python 3.12 setup | 🟢 |
| **L3** | Docker Desktop (postgres/redis/ollama) | 🟢 |
| **L4** | `.env` + pydantic-settings | 🟢 |
| **L5** | First Server Run + Health check | 🟢 |

---

# Lesson 1 — Tools Install

| Tool | Version | ရည်ရွယ်ချက် |
|---|---|---|
| Python | 3.12 | backend |
| **uv** | latest | package manager |
| Node.js | 22 LTS | desktop |
| Docker Desktop | latest | postgres/redis/ollama |
| Ollama Desktop | latest | LLM + embeddings |
| Git | latest | repo |

---

# Lesson 2 — uv + Project Setup

```powershell
# Windows PowerShell
irm https://astral.sh/uv/install.ps1 | iex
uv --version

# Project
mkdir ~/my-api && cd ~/my-api
uv venv                       # .venv/ folder ဖန်တီး
uv pip install fastapi uvicorn pydantic pydantic-settings
```

---

# Lesson 3 — Docker Local Services

```bash
# Postgres + pgvector
docker run -d --name lab-pg \
  -e POSTGRES_PASSWORD=postgres \
  -p 55432:5432 \
  pgvector/pgvector:pg16

# Redis
docker run -d --name lab-redis -p 6379:6379 redis:7

# Ollama + models
docker run -d --name lab-ollama -p 11434:11434 ollama/ollama:latest
docker exec lab-ollama ollama pull nomic-embed-text
docker exec lab-ollama ollama pull llama3.2:3b
```

**⚠️ Port 55432** — host 5432 က ပုံမှန် Postgres နဲ့ တိုက်မိလို့ ဒီ project convention။

---

# Lesson 4 — .env File

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/assistant
REDIS_URL=redis://127.0.0.1:6379/0
OPENAI_API_KEY=sk-or-your-key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
CHAT_MODEL=z-ai/glm-5.3-flash
EMBED_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://127.0.0.1:11434
FALLBACK_ENABLED=1
JWT_SECRET=change-me-32-chars-minimum
```

**⚠️ `127.0.0.1` NOT `localhost`** — Windows `localhost` = IPv6 `::1` → ~130s timeout
(ကျွန်တော်တို့ ကြုံခဲ့ဖူးတဲ့ real bug)။

---

# Lesson 5 — First Server Run

```bash
uv run uvicorn main:app --reload --port 8000

# Health check
curl http://127.0.0.1:8000/health
# → {"status": "ok"}

# Swagger UI — browser
# http://127.0.0.1:8000/docs
```

---

# 🔧 Lab M1 — Local KB Ingestion (Confluence မလိုဘဲ)

```bash
mkdir kb_files
cat > kb_files/vpn-guide.md <<'EOF'
# VPN Reconnection Guide
## Prerequisites
- Cisco AnyConnect installed
## Steps
1. Open Cisco AnyConnect
2. Enter vpn.company.com
3. Authenticate with LDAP credentials
EOF

# Manual article via API
curl -X POST http://127.0.0.1:8000/api/knowledge/articles \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Test","domain":"general","body":"Test content for embedding"}'

# Chunks ရောက်ပြီလား
docker exec -it lab-pg psql -U postgres -d assistant \
  -c "SELECT COUNT(*) FROM langchain_pg_embedding;"
```

---

# ✅ Self-Check M1

1. `uv` နဲ့ `pip` — အားသာချက် ၂ ခု ပြပါ။
2. Postgres port က ဘာလို့ 55432 ဖြစ်ရလဲ?
3. `localhost` vs `127.0.0.1` — Windows မှာ ဘာကွာလဲ?
4. Ollama မှာ ဘယ် model ၂ ခု pull ရမလဲ? ဘာလို့လဲ?

---

> **နောက်တစ်ဆင့်** — M2 (FastAPI Core) folder ထဲ `00-crash-course.md` ကို ဆက်လေ့လာပါ။