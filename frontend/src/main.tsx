/* eslint-disable no-restricted-globals -- the build-freshness probe reads a static
   /index.html, not an API; apiFetch would attach auth and parse JSON. */
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

/* Registers the install/service worker in a production build only. In dev it would cache
   HMR modules and serve stale code; the worker fails silently, because an install-less page
   must still work everywhere. */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`/sw.js?v=${__APP_VERSION__}`).catch(() => {
      /* installability is a bonus, never a requirement */
    });
  });
}

/* A phone keeps the app in memory for days, so a deployment could go unnoticed until the tab
   was killed — a fixed sentence kept showing the old wording. Ask for index.html (never the
   cache) whenever the app regains focus, and reload if it points at a different bundle. */
if (import.meta.env.PROD) {
  const bundled = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;

  const refreshIfStale = async () => {
    if (!bundled || document.visibilityState === "hidden") return;
    try {
      const html = await fetch("/index.html", { cache: "no-store" }).then((r) => r.text());
      const served = html.match(/src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
      if (!served) return;
      if (served.split("/").pop() !== bundled.split("/").pop()) window.location.reload();
    } catch {
      /* offline: the cached shell is the right answer */
    }
  };

  window.addEventListener("focus", refreshIfStale);
  document.addEventListener("visibilitychange", refreshIfStale);
}
