## 🔧 Tutorial 10.1 — သုညမှ Desktop App တည်ဆောက်

```bash
npm create vite@latest my-app -- --template react-ts
cd my-app
npm i -D tailwindcss @tailwindcss/vite
npm i react-markdown remark-gfm lucide-react clsx tailwind-merge

# 1. tailwind v4 setup (CSS import)
echo '@import "tailwindcss";' > src/index.css

# 2. shared/api/client.ts (single transport)
# 3. features/chat/api.ts + useChatStream hook
# 4. App.tsx — hash-based routing
```

## 🔧 Tutorial 10.2 — SSE Client Implementation (ကိုယ်တိုင် ရေး)

အပေါ်က skeleton ကို ယူပြီး —
1. `stage` event → **pipeline tracker** UI update
2. `token` event → **message bubble** content append (typing effect)
3. `meta` event → **sources + confidence badge** render
4. `caution` event → **security notice** card
5. `done` event → **final message state** + usage tokens display

