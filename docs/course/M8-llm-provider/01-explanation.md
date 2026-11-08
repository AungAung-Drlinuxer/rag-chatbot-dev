# M8 — LLM Provider Layer

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Config Precedence (အရေးကြီးဆုံး concept)

```python
# 1️⃣ DB `system_settings['llm']` (Settings UI ကနေ hot-change) — 30s TTL cache
# 2️⃣ env `SETTINGS` (.env file)
# 3️⃣ defaults in code
```

**ဘာလို့ ဒီလိုလဲ?** — Production မှာ OpenRouter key ပြောင်းလျှင်
**app restart မလိုဘူး** — Settings UI မှာ ပြင်လိုက်တာနဲ့ ချက်ချင်း အလုပ်လုပ်မယ်။

### Dual Failover Pattern

```python
def stream_answer(question, context):
    llm = make_llm()   # primary: OpenRouter
    try:
        yield from llm.stream(...)
        # usage captured on final sentinel token
    except ProviderError as e:
        logger.warning(f"LLM primary failed: {e}")
        if SETTINGS.fallback_enabled:
            fb = _build_local_ollama()   # ChatOllama llama3.2:1b
            yield from fb.stream(...)
        else:
            yield "⚠️ AI provider temporarily unavailable"
```

**⚠️ Lesson** — Streaming context ထဲမှာ error **တိုက်ရိုက် catch လုပ်ရမယ်** —
API call ကို wrap လုပ်မိတ်ဆို့ fallback မရောက်မနေရ။

**⚠️ Lesson 2** — CPU model (`llama3.2:1b`) — context 2.2k+ token တင်ရင်
first token 26 စက္ကန့် ကြာသည်။ **context cap ~4k chars** မဖြစ်မနေ လုပ်ရမယ်။

