/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite + Vitest config for the AgentLens dashboard (spec §13.9, §18).
 *
 * `build` emits a static SPA bundle that the local API serves (same-origin),
 * with the runtime token + API base injected into index.html at serve time.
 * `test` runs the dashboard component/integration suite under jsdom.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    css: false,
  },
});
