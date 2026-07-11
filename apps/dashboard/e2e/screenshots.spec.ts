/**
 * README screenshot capture (spec §22.1 "screenshots or generated local
 * screenshots").
 *
 * Reuses the e2e `globalSetup` boot verbatim — it already creates an isolated
 * `AGENTLENS_HOME`, scans synthetic fixtures (including a repeated-reads
 * session that triggers TOOLS-001), seeds a controlled `AGENTLENS_CLAUDE_HOME`
 * with a Configuration Doctor finding, and boots `agentlens dashboard` on
 * 127.0.0.1:7391. **Synthetic data only — never real ~/.claude (§21).**
 *
 * Gated by `AGENTLENS_SCREENSHOTS=1` so it does NOT run during normal
 * `pnpm test:e2e` or CI (no PNG writes, no failures). Regenerate the README
 * screenshots with:
 *
 *   pnpm --filter @agentlens/cli build   # ensure CLI is built
 *   AGENTLENS_SCREENSHOTS=1 pnpm --filter @agentlens/dashboard exec playwright test e2e/screenshots.spec.ts
 *
 * PNGs are written to `docs/img/` at the repo root and committed.
 */
import { test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const IMG_DIR = join(REPO_ROOT, "docs", "img");

const ENABLED = process.env.AGENTLENS_SCREENSHOTS === "1";
// When disabled, this file defines zero tests — no PNG writes, and no side
// effects beyond the shared globalSetup boot.

const VIEWPORT = { width: 1280, height: 860 } as const;

async function capture(page: Page, file: string, hash: string): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto(hash);
  // Let charts (Recharts) and TanStack Query calls settle before capturing.
  await page.waitForLoadState("networkidle");
  // Nudge any async repaints (Recharts animations) one more frame.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(IMG_DIR, file), fullPage: true });
}

if (!ENABLED) {
  // Define one skipped test so the file is valid when CI runs the whole e2e
  // directory without the AGENTLENS_SCREENSHOTS gate. The real screenshot
  // suite is defined only when the gate is set.
  test.skip("README screenshots are generated with AGENTLENS_SCREENSHOTS=1", () => {});
} else {
  mkdirSync(IMG_DIR, { recursive: true });

  test.describe("README screenshots (synthetic fixtures only)", () => {
    test("overview", async ({ page }: { page: Page }) => {
      await capture(page, "overview.png", "/#/overview");
    });

    test("sessions", async ({ page }: { page: Page }) => {
      await capture(page, "sessions.png", "/#/sessions");
    });

    test("session detail", async ({ page }: { page: Page }) => {
      await page.setViewportSize(VIEWPORT);
      await page.goto("/#/sessions");
      await page.waitForLoadState("networkidle");
      await page.locator("tbody tr").first().click();
      await page.waitForURL(/#\/session\//);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(IMG_DIR, "session-detail.png"), fullPage: true });
    });

    test("recommendations", async ({ page }: { page: Page }) => {
      await capture(page, "recommendations.png", "/#/recommendations");
    });

    test("coaching", async ({ page }: { page: Page }) => {
      await capture(page, "coaching.png", "/#/coaching");
    });

    test("doctor", async ({ page }: { page: Page }) => {
      await capture(page, "doctor.png", "/#/doctor");
    });
  });
}
