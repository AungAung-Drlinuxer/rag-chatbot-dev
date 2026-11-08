# rag-chatbot — DEV line

ဒါက RAG IT-help chatbot ရဲ့ **dev / preview** line ပါ။ Production repo နဲ့ ခွဲထားတယ် —
ဒီ folder မှာ dev အတွက် လိုတာပဲ ရှိတယ်။

- Version: **dev-1.0.1** (`frontend/package.json`)
- Images: `harbor.drlinuxer.com/rag-chatbot/frontend:dev-1.0.1`, `…/backend:dev-1.0.1`
- Namespace: `rag-chatbot-dev`
- Host: `dev-chat.drlinuxer.com`

## ဘာတွေ ပါလဲ

```
backend/        FastAPI + LangGraph RAG (PostgreSQL/pgvector, Ollama, Redis)
frontend/       React 18 + Vite + Tailwind client
infra/k8s-dev/  dev namespace manifests (database, backend, frontend, ingress)
docs/           architecture / course material (prod runbooks, QA screenshots မပါ)
```

## ဘာတွေ မပါဘူး (တမင်ဖြုတ်ထားတယ်)

- `infra/k8s/` — production manifests (prod namespace၊ CNPG HA၊ monitoring၊ celery)
- `infra/kasm/`, `infra/sql/`, `infra/docker/ollama-airgap/` — prod infra scripts
- `docs/qa/` — prod QA screenshots (~72 MB)
- `docs/ops/`, `docs/plans/`, `docs/openbao-*` — prod runbooks/roadmap
- `docs/notion-clickup-integration-guide.md` — ဖြုတ်ထားတဲ့ integration တွေအတွက်

## Integrations

**Confluence + Jira ပဲ။** Notion, Anytype, XWiki, Hashnode, ClickUp, OpenProject, Keycloak
တို့ကို frontend catalogue နဲ့ backend module တွေကပါ ဖြုတ်ထားတယ်။ LDAP ကို မဖြုတ်ဘူး —
အဲဒါ authentication backend။

## Local run

```bash
# backend
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# frontend
cd frontend
npm ci
npm run dev                 # http://localhost:5173
```

Gate စစ်ရန်:

```bash
cd frontend && npm run build && npm run lint && npx vitest run
cd ../backend && uv run pytest -q tests   # DB လိုတဲ့ test တွေက DATABASE_URL လိုတယ်
```

## Deploy (dev only)

```bash
docker build -t harbor.drlinuxer.com/rag-chatbot/frontend:dev-1.0.1 frontend/
docker build -t harbor.drlinuxer.com/rag-chatbot/backend:dev-1.0.1 backend/
kubectl apply -f infra/k8s-dev/
```

`infra/k8s-dev/20-database.yaml` က ကိုယ်ပိုင် Postgres (pgvector) ကို ဆောက်တယ် — prod DB ကို
မထိ။ Secret တွေကို manifest ထဲ မထည့်ရ။
