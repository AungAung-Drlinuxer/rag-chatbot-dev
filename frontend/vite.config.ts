import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 1420, strictPort: true, // strictPort: Tauri dev URL must be exactly 1420
    proxy: {
      // Local preview/dev: same-origin /api just like the prod nginx conf.
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  clearScreen: false,
  build: {
    outDir: "dist",
    // shiki bundles grammars for hundreds of languages as dynamic imports.
    // We only ship the 8 langs we registered, but rollup still emits per-grammar
    // chunks; cap what the browser preloads so page load stays fast.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Split the heavy vendors out of the app entry chunk. Function form (not the
        // `{ name: [...] }` map) because Vite 8's Rolldown output types only accept it.
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (/node_modules\/(react-markdown|remark-gfm|remark-|micromark|mdast|hast|unist)/.test(id)) {
            return "markdown";
          }
          return undefined;
        },
      },
    },
  },
});
