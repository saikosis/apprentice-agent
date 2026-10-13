import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8080" }, fs: { allow: [".."] } },
  build: {
    outDir: "../backend/app/static",
    emptyOutDir: true,
    // /demo/ is its own entry so StaticFiles serves it without SPA rewrites; views route by #hash.
    rollupOptions: { input: { main: resolve(__dirname, "index.html"), demo: resolve(__dirname, "demo/index.html") } },
  },
  test: { environment: "jsdom" },
});
