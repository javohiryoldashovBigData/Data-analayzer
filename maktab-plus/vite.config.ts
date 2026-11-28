import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Three pages: index.html = the public website (what Maktab+ is + sign-up),
// live.html = the real app (API server + PostgreSQL),
// prototype.html = the Phase 0 prototype (sample data in the browser).
const api = { "/api": "http://localhost:8787" };
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), live: resolve(__dirname, "live.html"), prototype: resolve(__dirname, "prototype.html") } } },
  server: { proxy: api },
  preview: { proxy: api },
});
