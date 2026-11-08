# M2 — Backend FastAPI Core (Module Index)

> **Level:** 🟢→🟡 · **ခန့်မှန်းချိန်:** 6–8 နာရီ (crash course + labs + capstone)

## 📚 ဒီ Module ထဲမှာ

| File | အကြောင်းအရာ | ဘယ်လိုသူအတွက် |
|---|---|---|
| [`00-crash-course.md`](./00-crash-course.md) | **Essential crash course** — Lesson 1–7 (env → routes → pydantic → router → DI → lifespan → SSE) + 3 Labs + Capstone + Self-Check quiz | ⭐ **အခုမှစလေ့လာမည့်သူ** — အရင်ဖတ် |
| [`01-explanation.md`](./01-explanation.md) | Concept reference — project ၏ `main.py`/`api/`/`config.py` code map + SSE pattern | Crash course ပြီးပြီလျှင် နက်နက်ရှိုင်းရိုင်း ဖတ် |
| [`02-tutorial.md`](./02-tutorial.md) | Mini FastAPI SSE server + real project trace | Crash course နဲ့ တွဲပြီးလုပ် |
| [`04-self-check.md`](./04-self-check.md) | Quiz — 7 မေးခွန်း | Crash course နဲ့ တိုက်စစ် |
| [`capstone-solution.md`](./capstone-solution.md) | Capstone answer + scoring rubric | **ကိုယ့်ဘာသာ ရေးပြီးမှ ဖွင့်** |

## 🧭 Crash Course လေ့လာပုံ (ရက် ၃ ရက် plan)

**Day 1 — Python + Routes (Lesson 1–2)**
- uv setup → first FastAPI app → path/query params → run + `/docs` ကြည့်

**Day 2 — Models + Auth (Lesson 3–5)**
- Pydantic models → APIRouter → `Depends` JWT auth → **Lab 1** (login + tickets CRUD)

**Day 3 — Streaming (Lesson 6–7)**
- lifespan → **SSE complete endpoint** → curl -N စမ်း → **Lab 2** → **Capstone**

## 🎯 Learning Outcome

ဒီ Module ပြီးလျှင် —
* FastAPI project သုညမှ တည်ဆောက်နိုင်မယ် (routes + models + auth)
* Pydantic validation + JWT `Depends` ကို ရေးနိုင်မယ်
* **SSE streaming endpoint** ကို ကိုယ်တိုင် ရေးပြီး client ဘက် parse လုပ်နိုင်မယ်
* ဒီ project ၏ `main.py` + `api/*.py` code များကို လွတ်လွတ်လပ်လပ် ဖတ်နိုင်မယ်

## 🔗 မိတ်ဆက်

* **Course Guide** — `docs/course-project-guide.md` M2 section
* **Master Workbook** — `docs/course-workbook-tutorials-labs.md`
* **နောက် Module** — `../M3-postgres-pgvector/README.md`