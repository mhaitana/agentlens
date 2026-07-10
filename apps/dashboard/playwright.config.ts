/**
 * Playwright E2E config (spec §21.4, §26).
 *
 * Browsers are pinned inside the repo (`PLAYWRIGHT_BROWSERS_PATH`) so nothing
 * is written outside `~/Projects/agentlens`. The dashboard server + seeded DB
 * are owned by `globalSetup` (see e2e/global-setup.ts); tests hit a fixed
 * loopback `baseURL`. No mocks, no real ~/.claude (§21).
 */
import { defineConfig, devices } from "@playwright/test";

// Pin browsers inside the repo so `pnpm test:e2e` works without an external
// env var; the install step uses the same path.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= new URL(
  "../../.playwright-browsers",
  import.meta.url,
).pathname;

const PORT = Number(process.env.AGENTLENS_E2E_PORT ?? 7391);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
