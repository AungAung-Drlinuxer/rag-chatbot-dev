## 🔧 Tutorial 1.1 — Local Lab (အပြည့်အစုံ)

```bash
# === Backend Setup ===
git clone <your-repo> && cd rag-chatbot/backend

# Python 3.12 လိုအပ်
python --version    # 3.12.x ဖြစ်ရမည်

# uv install လုပ် (Windows PowerShell)
irm https://astral.sh/uv/install.ps1 | iex

# Dependencies install
uv sync

# Local infra start
docker compose -f docker-compose.dev.yml up -d

# .env ဖန်တီး
cat > .env <<'ENV'
DATABASE_URL=postgresql://postgres:postgres@localhost:55432/assistant
REDIS_URL=redis://localhost:6379/0
OPENAI_API_KEY=sk-or-your-key-here
OPENAI_BASE_URL=https://openrouter.ai/api/v1
CHAT_MODEL=z-ai/glm-5.3-flash
EMBED_MODEL=nomic-embed-text
OLLAMA_BASE_URL=http://127.0.0.1:11434
FALLBACK_ENABLED=1
JWT_SECRET=change-me-32-chars-minimum-secret
ENV

# ⚠️ GOTCHA: localhost → 127.0.0.1 (Windows IPv6 timeout 130s bug)
# ⚠️ Postgres host port = 55432 (5432 က local PostgreSQL နဲ့ တိုက်မိလို့)

# Database schema ကို auto-create လုပ် (app boot လုပ်လိုက်လျှင်)
uv run uvicorn app.main:app --reload --port 8000

# health check
curl http://127.0.0.1:8000/health   # {"status":"ok"}
```

```bash
# === Desktop Setup ===
cd ../desktop
npm install
npm run dev        # http://localhost:5173
# Login dev fallback: username=dev, password=dev
```

