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
