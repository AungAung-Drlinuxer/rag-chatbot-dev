# M10 — Desktop App Crash Course (အပြည့်အစုံ)

> `M10-desktop-app/00-crash-course.md`

## L1 — React အခြေခံ

```tsx
function Ticket({ id, subject }: { id: string; subject: string }) {
  return <div>{id} — {subject}</div>;
}

function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n+1)}>{n}</button>;
}
```

## L2 — TypeScript Types

```tsx
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ragTrace?: { stages: Record<string, number>; totalMs: number };
};
```

## L3 — Tailwind CSS

```tsx
<div className="flex gap-2 rounded-2xl border border-slate-200 p-4">
  <b className="text-blue-600">{title}</b>
</div>
```

## L4 — Single Transport (apiFetch)

```typescript
export async function apiFetch(input: RequestInfo, init?: RequestInit) {
  const r = await fetch(input, {
    ...init, headers: { ...(init?.headers || {}), ...authHeaders() },
  });
  if (r.status === 401) { clearSession(); location.hash = "#/login"; }
  return r;
}
```

## L5 — SSE Client (fetch + ReadableStream)

```typescript
const reader = res.body!.getReader();
const decoder = new TextDecoder();
let buffer = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const parts = buffer.split("\n\n");     // events separated
  buffer = parts.pop() ?? "";             // partial chunk handling
  for (const block of parts) {
    const ev = /event: (\w+)/.exec(block)?.[1];
    const data = JSON.parse(/data: (.*)/.exec(block)![1]);
    if (ev === "token") onToken(data.token);
    if (ev === "stage") onStage(data);
  }
}
```

## 🔧 Lab M10 — Mini Chat Client

Vite + Tailwind setup → input + message list + SSE parse + pipeline tracker →
`npm run dev` နဲ့ M2 capstone server နဲ့ ချိတ်စမ်း။

## ✅ Self-Check M10

1. EventSource မသုံးရတဲ့ အကြောင်းရင်း။
2. 401 ကို တစ်နေရာတည်း ကိုင်တွယ်လဲ?
3. SSE partial chunk ကို ဘာလို့ buffer လုပ်ရလဲ?
4. Tauri 2 က Electron ထက် ဘာလို့ ပေါ့လဲ?