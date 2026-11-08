# M1 — Lab Setup

## 📖 အသေးစိတ်ရှင်းလင်းချက်

**uv** — Python package manager အသစ်။ pip ထက် ၁၀ ဆ မြန်သည်။
pyproject.toml (Rust-style lock file) နဲ့ အလုပ်လုပ်သည်။

**pydantic-settings** — `.env` file ထဲက တန်ဖိုးများကို type-checked Python object အဖြစ် ဖတ်ပေးသည်။
ဥပမာ — `JWT_SECRET` က string ဖြစ်ရမည်၊ `FALLBACK_ENABLED=1` က bool ဖြစ်ရမည် — မဟုတ်ရင်
app startup မှာချက်ချင်း error ပြသည် (silent bug မဖြစ်စေရန်)။

**docker-compose.dev.yml** — local development အတွက် လိုအပ်တဲ့ infrastructure ၃ ခုကို ချက်ချင်းတည်ဆောက်ပေးသည်-
- `postgres` (pgvector extension ပါ) — port `55432` (host native 5432 က ယူထားလို့)
- `valkey/redis` — cache + celery broker
- `ollama` — local LLM + embeddings

