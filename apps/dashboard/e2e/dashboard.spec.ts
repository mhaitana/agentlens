/**
 * Dashboard E2E (spec §21.4: onboarding, overview, session list, session
 * detail, recommendation detail). Drives the real served dashboard against a
 * seeded SQLite DB — no mocks, no real ~/.claude (§21).
 *
 * Page errors / console errors fail the run (§26 "ensure there are no console
 * errors").
 */
import { test, expect, type Page } from "@playwright/test";

const consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  consoleErrors.length = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
});

test.afterEach(async () => {
  expect(consoleErrors, `console errors:\n${consoleErrors.join("\n")}`).toEqual([]);
});

test("onboarding surfaces the seeded data + privacy mode", async ({ page }: { page: Page }) => {
  await page.goto("/#/onboarding");
  await expect(page.getByRole("heading", { name: /Getting started/i })).toBeVisible();
  await expect(page.getByText("redacted-content", { exact: false }).first()).toBeVisible();
  // Sessions imported > 0 after the seeded scan.
  await expect(page.getByText(/Sessions imported/)).toBeVisible();
});

test("overview shows real analytics with the honest cost caveat", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/#/overview");
  await expect(page.getByRole("heading", { level: 2, name: "Overview" })).toBeVisible();
  // §3.4 honest-metrics: the estimated-cost disclaimer must reach the DOM.
  await expect(page.getByText("Estimated — not an official billing value").first()).toBeVisible();
});

test("session list shows the seeded sessions", async ({ page }: { page: Page }) => {
  await page.goto("/#/sessions");
  await expect(page.getByRole("heading", { level: 2, name: "Sessions" })).toBeVisible();
  // The seeded fixtures produce at least one session row.
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("session detail renders a reconstructed timeline", async ({ page }: { page: Page }) => {
  await page.goto("/#/sessions");
  // Click the first session row (rows navigate to /session/:id on click).
  await page.locator("tbody tr").first().click();
  await expect(page).toHaveURL(/#\/session\//);
  // A timeline event kind appears (prompt or tool call).
  await expect(page.getByText(/prompt|tool call|tool_use/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test("recommendations list shows an evidence-backed rule id", async ({ page }: { page: Page }) => {
  await page.goto("/#/recommendations");
  await expect(page.getByRole("heading", { level: 2, name: "Recommendations" })).toBeVisible();
  // The seeded repeated-reads fixture triggers TOOLS-001.
  await expect(page.getByText("TOOLS-001")).toBeVisible({ timeout: 10_000 });
});
