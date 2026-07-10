/**
 * `agentlens integrate claude-code` (spec §14.5, §16) — register the
 * observation-only AgentLens Claude Code plugin with the user's Claude Code
 * install, with a full show-plan → back up → install → validate → health-check
 * → explain-rollback flow. Supports `--status`, `--remove`, `--dry-run`, and
 * `--json`. Honours `AGENTLENS_CLAUDE_HOME`/`--claude-home` and
 * `AGENTLENS_PLUGIN_DIR`/`--plugin-dir` so it never depends on the developer's
 * real `~/.claude` in tests (§21).
 */
import { Command } from "commander";
import pc from "picocolors";
import {
  buildInstallPlan,
  applyInstall,
  applyRemove,
  buildStatus,
  resolveClaudeHome,
  resolvePluginSourceDir,
  MARKETPLACE_NAME,
  ENABLED_PLUGIN_KEY,
} from "../integrate/claude-code.js";
import { resolveHome } from "../context.js";

export function makeIntegrateCommand(): Command {
  const integrate = new Command("integrate").description(
    "Integrate AgentLens with a coding agent (claude-code).",
  );

  const claude = new Command("claude-code")
    .description("Register the AgentLens observation-only plugin with Claude Code.")
    .option("--status", "Show the current integration status without changing anything.")
    .option("--remove", "Remove only the AgentLens-owned Claude Code configuration.")
    .option("--dry-run", "Show the planned changes without writing anything.")
    .option("--claude-home <dir>", "Override the Claude Code home (~/.claude).")
    .option("--plugin-dir <dir>", "Override the bundled plugin source directory.")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: IntegrateOpts) => {
      const agentLensHome = resolveHome();
      const claudeHome = resolveClaudeHome(opts.claudeHome);
      const io = { claudeHomeOverride: opts.claudeHome, pluginSourceDirOverride: opts.pluginDir };
      const nowIso = new Date().toISOString();

      if (opts.status) {
        const status = buildStatus(claudeHome, agentLensHome, io);
        if (opts.json) {
          process.stdout.write(JSON.stringify(status, null, 2) + "\n");
          return;
        }
        printStatus(status);
        return;
      }

      if (opts.remove) {
        const result = applyRemove(claudeHome, agentLensHome, io, Boolean(opts.dryRun), nowIso);
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
          return;
        }
        printRemove(result);
        return;
      }

      // Default: install (with --dry-run support).
      const plan = buildInstallPlan(claudeHome, agentLensHome, io);
      if (!opts.json && !opts.dryRun) printPlan(plan);
      const result = applyInstall(claudeHome, agentLensHome, io, Boolean(opts.dryRun), nowIso);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify({ ...result, detected: plan.detected }, null, 2) + "\n",
        );
        return;
      }
      printInstall(result, plan, Boolean(opts.dryRun));
    });

  integrate.addCommand(claude);
  return integrate;
}

interface IntegrateOpts {
  status?: boolean;
  remove?: boolean;
  dryRun?: boolean;
  claudeHome?: string;
  pluginDir?: string;
  json?: boolean;
}

function yesNo(b: boolean): string {
  return b ? pc.green("yes") : pc.red("no");
}

function printPlan(plan: ReturnType<typeof buildInstallPlan>): void {
  process.stdout.write(pc.bold(pc.cyan("AgentLens → Claude Code integration plan\n")));
  process.stdout.write(
    `  claude binary:  ${plan.detected.found ? `${plan.detected.binPath} (${plan.detected.version})` : pc.yellow("not found")}\n`,
  );
  if (plan.detected.note) process.stdout.write(pc.dim(`                  ${plan.detected.note}\n`));
  process.stdout.write(`  already registered: ${yesNo(plan.alreadyRegistered)}\n`);
  process.stdout.write(`  marketplace dir:    ${plan.marketplaceRoot}\n`);
  process.stdout.write(`  plugin source:      ${plan.pluginSourceDir}\n`);
  if (plan.settingsAdds.length > 0) {
    process.stdout.write(pc.bold("  settings.json — will add:\n"));
    for (const k of plan.settingsAdds) process.stdout.write(`    + ${k}\n`);
  } else {
    process.stdout.write(pc.dim("  settings.json — no changes needed (already registered)\n"));
  }
  process.stdout.write(
    pc.dim(
      "  Unrelated hooks/plugins/formatting are preserved. Run with --dry-run to preview without writing.\n",
    ),
  );
}

function printInstall(
  result: ReturnType<typeof applyInstall>,
  plan: ReturnType<typeof buildInstallPlan>,
  dryRun: boolean,
): void {
  if (dryRun) {
    process.stdout.write(pc.bold(pc.cyan("Dry run — no changes written.\n")));
    printPlan(plan);
    process.stdout.write(pc.dim(`  Backups would go to <home>/backups/. ${result.rollbackHint}\n`));
    return;
  }
  process.stdout.write(pc.bold(pc.green("Integration applied.\n")));
  process.stdout.write(`  settings:        ${result.settingsPath}\n`);
  process.stdout.write(`  marketplace:     ${result.marketplaceRoot}\n`);
  for (const b of result.backedUp) process.stdout.write(pc.dim(`  backup:          ${b.backup}\n`));
  process.stdout.write(`  registered:      ${yesNo(result.registered)}\n`);
  process.stdout.write(
    `  validation:      settings=${yesNo(result.validation.settingsParse)} keys=${yesNo(result.validation.keysPresent)} marketplace=${yesNo(result.validation.marketplaceValid)}\n`,
  );
  const health = result.health.collectorOnline;
  process.stdout.write(
    `  collector:       ${health === "unknown" ? pc.dim("not running (events spool locally)") : health ? pc.green("online") : pc.yellow("offline (events spool locally)")}\n`,
  );
  process.stdout.write(pc.dim(`  Rollback: ${result.rollbackHint}\n`));
}

function printRemove(result: ReturnType<typeof applyRemove>): void {
  if (result.dryRun) {
    process.stdout.write(pc.bold(pc.cyan("Dry run — no changes written.\n")));
  } else {
    process.stdout.write(pc.bold(pc.green("Integration removed.\n")));
  }
  for (const b of result.backedUp) process.stdout.write(pc.dim(`  backup:          ${b.backup}\n`));
  process.stdout.write(`  marketplace removed: ${yesNo(result.removedMarketplace)}\n`);
  if (result.removedSettingsKeys.length > 0) {
    process.stdout.write(pc.bold("  removed (AgentLens-owned only):\n"));
    for (const k of result.removedSettingsKeys) process.stdout.write(`    - ${k}\n`);
  } else {
    process.stdout.write(pc.dim("  nothing AgentLens-owned was found to remove\n"));
  }
  if (result.otherPluginsPreserved.length > 0) {
    process.stdout.write(
      pc.dim(`  preserved ${result.otherPluginsPreserved.length} other enabled plugin(s)\n`),
    );
  }
  process.stdout.write(pc.dim(`  Rollback: ${result.rollbackHint}\n`));
}

function printStatus(status: ReturnType<typeof buildStatus>): void {
  process.stdout.write(pc.bold(pc.cyan("AgentLens → Claude Code integration status\n")));
  process.stdout.write(
    `  claude binary:     ${status.detected.found ? `${status.detected.binPath} (${status.detected.version})` : pc.yellow("not found")}\n`,
  );
  if (status.detected.note)
    process.stdout.write(pc.dim(`                     ${status.detected.note}\n`));
  process.stdout.write(`  registered:        ${yesNo(status.registered)}\n`);
  process.stdout.write(
    `  marketplace:       ${status.marketplaceInstalled ? `${status.marketplaceRoot}` : pc.red("not installed")}\n`,
  );
  process.stdout.write(`  plugin manifest:   ${yesNo(status.pluginManifestValid)}\n`);
  process.stdout.write(`  hook events:       ${status.hookEventCount}\n`);
  const health = status.collectorOnline;
  process.stdout.write(
    `  collector:         ${health === "unknown" ? pc.dim("not running") : health ? pc.green("online") : pc.yellow("offline")}\n`,
  );
  process.stdout.write(pc.dim(`  settings:          ${status.claudeSettingsPath}\n`));
  process.stdout.write(pc.dim(`  marketplaces:      ${status.knownMarketplacesPath}\n`));
  if (status.otherEnabledPlugins.length > 0) {
    process.stdout.write(
      pc.dim(
        `  other enabled plugins (${status.otherEnabledPlugins.length}): ${status.otherEnabledPlugins.join(", ")}\n`,
      ),
    );
  }
}

// Re-exported for tests / other commands that need the constants.
export { resolvePluginSourceDir, MARKETPLACE_NAME, ENABLED_PLUGIN_KEY };
