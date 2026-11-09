# Frontend — React 18 + Vite + Tailwind

The SPA behind every screen. Built to static files and served by nginx, which also proxies
`/api` to the backend so the browser is same-origin (and SSE works without CORS).

```
src/features/<domain>/   one folder per screen: pages/, components/, api.ts, model.ts
src/components/          shared UI (Composer, MarkdownMessage, FloatingChat, ui/)
src/lib/                 http client, SSE parser, formatters
src/shared/              cross-feature types and hooks
src/styles.css           design tokens for light/dark + Tailwind layers
nginx.conf               SPA fallback, /api proxy (buffering off), cache policy
```

Map: [../docs/PROJECT-STRUCTURE.md](../docs/PROJECT-STRUCTURE.md).

## Develop

```bash
npm ci
npm run dev        # http://127.0.0.1:1420 — strictPort on purpose (the Tauri dev URL)
```

`/api` is proxied to `127.0.0.1:8000`, so log in against the local backend exactly as you
would against the cluster.

## Gates

```bash
npm run build        # tsc + vite build
npm run lint         # eslint, max 40 warnings
npx tsc --noEmit
npx vitest run       # 144 tests
```

## Image

```bash
docker build -t <registry>/frontend:<tag> .
```

Multi-stage: Node builds `dist/`, then `nginxinc/nginx-unprivileged` serves it on **:8080** as
uid 101. The Service maps `80 → 8080`, so nothing upstream changes. Do not switch back to
`nginx:alpine`: that image needs root to bind :80.

## Conventions

- **Design tokens, not palette colours.** `var(--panel)`, `var(--accent)`, `var(--ok)`,
  `var(--warn)`, `var(--danger)` — the same markup has to work in both themes.
- **No mock data.** A panel with no data shows `—`; it never invents a number.
- **Test-visible strings are contract.** `aria-label`s and role names are asserted in
  `*.test.tsx`; renaming one means updating the test, not deleting it.
- **`dangerouslySetInnerHTML` only through `sanitizeShikiHtml()`** (code highlighting).

## Desktop shell (optional)

`src-tauri/` wraps the same build in a desktop window for machines without a browser. It is
not part of the cluster deployment; `npm run tauri dev` builds it locally.
