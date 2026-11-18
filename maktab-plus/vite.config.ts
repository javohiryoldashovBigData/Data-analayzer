import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Two pages: index.html = the Phase 0 prototype (sample data in the browser),
// live.html = the real app talking to the API server + PostgreSQL.
const api = { "/api": "http://localhost:8787" };
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), live: resolve(__dirname, "live.html") } } },
  server: { proxy: api },
  preview: { proxy: api },
});
