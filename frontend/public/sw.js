/*
 * Minimal service worker — its job is to make the app installable and to keep the shell
 * available when the network drops. Deliberately conservative:
 *
 *   - never touch /api (a cached answer or a cached 401 would be worse than an error)
 *   - navigations are network-first, so a new deployment is picked up on the next load;
 *     the cached shell is only a fallback
 *   - static files are stale-while-revalidate, hashed Vite assets included
 */
const VERSION = "v1";
const SHELL = "ith-shell-" + VERSION;
const ASSETS = "ith-assets-" + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(["/", "/index.html", "/manifest.webmanifest"])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health")) return;

  // Navigations: fresh HTML when possible, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL);
          cache.put("/index.html", res.clone()).catch(() => {});
          return res;
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Static: serve from cache, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(ASSETS);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
          return res;
        })
        .catch(() => null);
      return hit || (await network) || Response.error();
    })(),
  );
});
