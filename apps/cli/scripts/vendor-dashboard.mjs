/**
 * `prepack` hook for `@mhaitana/agentlens`.
 *
 * Copies the built Vite dashboard bundle (`apps/dashboard/dist`) into the CLI
 * package (`apps/cli/dashboard`) so the published package ships the dashboard
 * UI alongside the CLI. `resolveDashboardDir()` (apps/cli/src/commands/dashboard.ts)
 * then finds the vendored bundle relative to the package root.
 *
 * Runs automatically on `pnpm pack` / `pnpm publish` (and thus during
 * `changeset publish` in the release workflow), after `pnpm build` has produced
 * `apps/dashboard/dist`. Cross-platform via `fs.cpSync`.
 */
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../dashboard/dist/", import.meta.url));
const dest = fileURLToPath(new URL("../dashboard/", import.meta.url));

if (!existsSync(src)) {
  console.warn(
    "[vendor-dashboard] apps/dashboard/dist not found — skipping. " +
      "(Run `pnpm build` before packing/publishing.)",
  );
  process.exit(0);
}

cpSync(src, dest, { recursive: true });
console.log("[vendor-dashboard] copied apps/dashboard/dist -> apps/cli/dashboard");