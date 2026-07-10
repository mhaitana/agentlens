/**
 * `agentlens rules` (spec §16) — inspect and toggle the deterministic
 * recommendation rules. Subcommands: `list`, `explain`, `enable`, `disable`.
 *
 * Rules are versioned and threshold-overridable (§15.1). Enable/disable and
 * threshold overrides are stored in `analysis.ruleOverrides` (keyed by rule id)
 * and applied at rule-engine run time. `list`/`explain` support `--json` for
 * automation.
 */
import { Command } from "commander";
import pc from "picocolors";
import { RULE_METADATA, defaultRules } from "@agentlens/analysis-engine";
import { loadConfig, saveConfig } from "@agentlens/config";
import { resolveHome } from "../context.js";

/** Whether a rule id is currently disabled by config (default = enabled). */
function isEnabled(overrides: Record<string, unknown>, ruleId: string): boolean {
  const o = overrides[ruleId] as { enabled?: boolean } | undefined;
  return o?.enabled !== false;
}

/** All known rule ids, in spec order. */
const KNOWN_IDS = RULE_METADATA.map((m) => m.id);

export function makeRulesCommand(): Command {
  const cmd = new Command("rules").description(
    "Inspect and toggle the deterministic recommendation rules.",
  );

  cmd
    .command("list")
    .description("List all rules with category, severity, title and current state.")
    .option("--json", "Emit machine-readable JSON.")
    .action(async (opts: { json?: boolean }) => {
      const config = await loadConfig(resolveHome());
      const overrides = config.analysis.ruleOverrides;
      if (opts.json) {
        const rows = RULE_METADATA.map((m) => ({
          id: m.id,
          version: m.version,
          category: m.category,
          severity: m.severity,
          title: m.title,
          description: m.description,
          defaultThresholds: m.defaultThresholds,
          enabled: isEnabled(overrides, m.id),
        }));
        process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
        return;
      }
      for (const m of RULE_METADATA) {
        const on = isEnabled(overrides, m.id);
        const state = on ? pc.green("on ") : pc.red("off");
        process.stdout.write(
          `${pc.bold(m.id)} ${state} ${pc.dim(`[${m.category}/${m.severity}]`)} ${m.title}\n`,
        );
      }
    });

  cmd
    .command("explain")
    .description("Show full details and current configuration for a rule.")
    .argument("<ruleId>", "Rule id, e.g. TOOLS-001.")
    .option("--json", "Emit machine-readable JSON.")
    .action(async (ruleId: string, opts: { json?: boolean }) => {
      const meta = RULE_METADATA.find((m) => m.id === ruleId);
      if (!meta) {
        throw new Error(`Unknown rule "${ruleId}". Known: ${KNOWN_IDS.join(", ")}`);
      }
      const config = await loadConfig(resolveHome());
      const overrides = config.analysis.ruleOverrides;
      const override = (overrides[ruleId] as Record<string, unknown> | undefined) ?? {};
      const enabled = isEnabled(overrides, ruleId);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { ...meta, enabled, configuredThresholds: override.thresholds ?? null },
            null,
            2,
          ) + "\n",
        );
        return;
      }
      process.stdout.write(`${pc.bold(meta.id)} — ${meta.title}\n`);
      process.stdout.write(`  category: ${meta.category}\n`);
      process.stdout.write(`  severity: ${meta.severity}\n`);
      process.stdout.write(`  version:  ${meta.version}\n`);
      process.stdout.write(`  state:    ${enabled ? pc.green("enabled") : pc.red("disabled")}\n`);
      process.stdout.write(`  description: ${meta.description}\n`);
      process.stdout.write(`  default thresholds: ${JSON.stringify(meta.defaultThresholds)}\n`);
      if (override.thresholds) {
        process.stdout.write(`  configured thresholds: ${JSON.stringify(override.thresholds)}\n`);
      }
      // Show a live explanation from the rule's explain() hook.
      const rule = defaultRules().find((r) => r.id === ruleId);
      if (rule) {
        process.stdout.write(
          pc.dim("  Note: explanations are produced from live evidence at report time.\n"),
        );
      }
    });

  cmd
    .command("enable")
    .description("Enable a rule (removes any disable override).")
    .argument("<ruleId>", "Rule id, e.g. TOOLS-001.")
    .action(async (ruleId: string) => {
      await assertKnown(ruleId);
      const home = resolveHome();
      const config = await loadConfig(home);
      const overrides = { ...config.analysis.ruleOverrides };
      // Enabling = remove the disable override (revert to default = enabled).
      // Destructure-omit keeps the lint rule (no-dynamic-delete) satisfied.
      const { [ruleId]: _removed, ...rest } = overrides;
      void _removed;
      config.analysis.ruleOverrides = rest;
      await saveConfig(home, config);
      process.stdout.write(pc.green(`enabled ${ruleId}\n`));
    });

  cmd
    .command("disable")
    .description("Disable a rule (it will be skipped by the rule engine).")
    .argument("<ruleId>", "Rule id, e.g. TOOLS-001.")
    .action(async (ruleId: string) => {
      await assertKnown(ruleId);
      const home = resolveHome();
      const config = await loadConfig(home);
      const overrides = { ...config.analysis.ruleOverrides };
      overrides[ruleId] = { ...(overrides[ruleId] as object | undefined), enabled: false };
      config.analysis.ruleOverrides = overrides;
      await saveConfig(home, config);
      process.stdout.write(pc.green(`disabled ${ruleId}\n`));
    });

  return cmd;
}

async function assertKnown(ruleId: string): Promise<void> {
  if (!KNOWN_IDS.includes(ruleId)) {
    throw new Error(`Unknown rule "${ruleId}". Known: ${KNOWN_IDS.join(", ")}`);
  }
}
