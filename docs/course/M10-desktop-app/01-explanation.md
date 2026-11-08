# M10 — Desktop App (React + Vite + Tauri)

## 📖 အသေးစိတ်ရှင်းလင်းချက်

### Stack ရွေးချယ်မှု

| Library | ဘာလို့ |
|---|---|
| **React 18** | Hooks + functional components |
| **Vite** | Fast HMR (hot module reload) — Webpack ထက် မြန် |
| **TypeScript** | Type safety — runtime error ကို build-time မှာဖမ်း |
| **Tailwind CSS v4** | Utility-first CSS — no CSS file switching |
| **Radix UI** | Accessible primitives (dropdown/dialog) |
| **lucide-react** | Icon library |
| **react-markdown + remark-gfm** | LLM answer rendering (tables/lists) |
| **Tauri 2** | Desktop shell — lightweight vs Electron (~150MB Chromium မသယ်ရ) |

### Feature-based Structure

```
src/features/<domain>/
├── api.ts          # fetch wrappers (single page endpoints)
└── pages/XPage.tsx # UI
```

**ဘာလို့ ဒီလိုခွဲလဲ?** — Page တစ်ခု ပြင်ရင် **feature folder ထဲမှာပဲ အားလုံးရှိတယ်** —
global `components/` ထဲ ရှာစရာမလိုဘူး။

### Single Transport Layer (all API calls)

```typescript
// src/shared/api/client.ts
export async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, {
    ...init,
    headers: { ...(init?.headers || {}), ...authHeaders() },
  });
  if (r.status === 401) {
    clearSession();
    location.hash = "#/login";
  }
  return r;
}
```

**Beneath the hood** — တစ်ခုတည်းသော transport က — **auth header** + **401 redirect** ကို
တစ်နေရာတည်းမှာ ကိုင်တွယ်ပေးသည်။ Per-page fetch wrapper တွေက ဒီ function ကို ခေါ်ရုံ။

### SSE Streaming Client (အဓိက)

```typescript
// EventSource မသုံးရ — "EventSource cannot set Authorization header"
// fetch + ReadableStream သုံးရမယ်

const res = await fetch(`${BASE}/api/chat/stream`, {
  method: "POST",
  headers: { ...authHeaders(), "Content-Type": "application/json" },
  body: JSON.stringify({ message, session_id }),
});

const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";

for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });

  // SSE events separated by \n\n (double newline)
  const parts = buffer.split("\n\n");
  buffer = parts.pop() ?? "";   // last partial event → next read

  for (const block of parts) {
    const event = /event: (\w+)/.exec(block)?.[1];
    const data = JSON.parse(/data: (.*)/.exec(block)![1]);

    if (event === "stage") onStage(data);
    if (event === "token") onToken(data.token);   // append to bubble
    if (event === "meta") onMeta(data);           // sources, confidence
    if (event === "caution") onCaution(data);     // guardrail notice
    if (event === "done") onDone(data);           // message_id, usage
  }
}
```

**⚠️ Buffer partial-chunk** — network packet က တစ်ခါတည်း full event မပို့ဘူး။
buffer ထဲ စုထားပြီး `\n\n` တွေ့မှ parse လုပ်ရမယ်။

