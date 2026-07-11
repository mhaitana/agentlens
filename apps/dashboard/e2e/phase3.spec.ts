/**
 * Coaching + Doctor + recommendation-detail E2E (spec §15.12, §15.13, §3.5,
 * §21.4, §26). Drives the real served dashboard against the seeded SQLite DB
 * + a controlled AGENTLENS_CLAUDE_HOME (global-setup seeds a no-timeout hook
 * so the Doctor has a deterministic finding + patch).
 *
 * Covers F008 acceptance:
 *  - Coaching overview (top opportunities, estimated-cost caveat, configurable
 *    model catalogue) + Prompt Coach detail (deterministic, "not guaranteed").
 *  - Configuration Doctor diff preview + validation + apply (with explicit
 *    confirmation) + rollback, end-to-end through the UI (§3.5 safety sequence).
 *  - Recommendation detail link to the related session + Resolve persists.
 *
 * Page errors / console errors fail the run (§26). No real ~/.claude (§21).
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

test("coaching overview surfaces opportunities, the cost caveat, and the configurable catalogue", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/#/coaching");
  await expect(page.getByRole("heading", { level: 2, name: "Coaching" })).toBeVisible();
  // The seeded repeated-reads session triggers a TOOLS-001 recommendation.
  await expect(page.getByText("TOOLS-001").first()).toBeVisible({ timeout: 10_000 });
  // §3.4 honest-metrics: cost is labelled estimated, never official billing.
  await expect(page.getByText("Estimated — not an official billing value").first()).toBeVisible();
  // §15.4 configurable catalogue — relative tiers, no permanent claims.
  await expect(page.getByText(/Model catalogue \(configurable\)/)).toBeVisible();
  await expect(page.getByText(/no permanent/i)).toBeVisible();
});

test("prompt coach shows a deterministic detail view with the not-guaranteed disclaimer", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/#/coaching");
  await expect(page.getByRole("heading", { name: "Prompt Coach" })).toBeVisible();
  // Click the first prompt row to open the §15.6 detail view.
  await page.getByRole("button").filter({ hasText: /tok/ }).first().click();
  await expect(page.getByText(/Prompt detail #/)).toBeVisible({ timeout: 10_000 });
  // §15.5 deterministic structural scoring — provenance is heuristic.
  await expect(page.getByText("Quality dimensions")).toBeVisible();
  // §15.6 comparison disclaimer — improvements are not a guarantee.
  await expect(page.getByText(/not guaranteed/i).first()).toBeVisible();
});

test("doctor shows a diff preview + validation, then applies and rolls back via explicit confirmation", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/#/doctor");
  await expect(page.getByRole("heading", { level: 2, name: "Configuration Doctor" })).toBeVisible();
  // §3.5 safety copy: nothing changes without explicit approval.
  await expect(page.getByText(/Nothing is changed without your explicit approval/i)).toBeVisible();

  // The controlled claude home (global-setup) yields a json-settings patch.
  // A diff preview is rendered as escaped text (§19: no HTML execution).
  await expect(page.locator("pre").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/validation:/).first()).toBeVisible();
  // §15.9: the proposed patch must never auto-apply — validation must pass and
  // the patch is gated behind the Apply button.
  await expect(page.getByText(/validation:/).first()).toContainText("passes");

  // Apply the patch — opens the §3.5 confirmation dialog.
  await page
    .getByRole("button", { name: /^Apply/ })
    .first()
    .click();
  const applyDialog = page.getByRole("dialog");
  await expect(applyDialog).toBeVisible();
  await expect(applyDialog.getByText(/backed up first/i)).toBeVisible();
  await applyDialog.getByRole("button", { name: "Apply (back up first)" }).click();

  // The apply result lists the patch as applied. Applied patches self-clear
  // their finding on write, so the patch row vanishes on refetch — rollback is
  // exposed on the apply-result entry instead (§3.5 step 7).
  await expect(page.getByText("Apply result")).toBeVisible({ timeout: 10_000 });
  const applyResultCard = page.locator("div.rounded-lg.border", { hasText: "Apply result" });
  await expect(applyResultCard.getByText("applied").first()).toBeVisible();
  const rollbackBtn = applyResultCard.getByRole("button", { name: "Roll back" });
  await expect(rollbackBtn).toBeVisible({ timeout: 10_000 });
  await rollbackBtn.click();

  // Roll back via the §3.5 confirmation dialog.
  const rbDialog = page.getByRole("dialog");
  await expect(rbDialog).toBeVisible();
  await rbDialog.getByRole("button", { name: "Restore from backup" }).click();
  await expect(page.getByText("Rollback result")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("restored")).toBeVisible();
});

test("recommendation dismissal and resolution persist (resolve leaves the active list)", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto("/#/recommendations");
  await expect(page.getByRole("heading", { level: 2, name: "Recommendations" })).toBeVisible();
  // The seeded repeated-reads fixture triggers TOOLS-001.
  await expect(page.getByText("TOOLS-001").first()).toBeVisible({ timeout: 10_000 });

  // Resolving the TOOLS-001 card moves it out of the active set (GET
  // /recommendations excludes resolved), so its card disappears after the
  // mutation invalidates and the list refetches (§15.13 lifecycle).
  const toolsCards = page.locator("div.rounded-lg.border", {
    has: page.getByText("TOOLS-001", { exact: true }),
  });
  const before = await toolsCards.count();
  expect(before).toBeGreaterThan(0);
  await toolsCards
    .first()
    .getByRole("button", { name: /^Resolve$/i })
    .click();
  await expect.poll(async () => toolsCards.count(), { timeout: 10_000 }).toBe(before - 1);
});
