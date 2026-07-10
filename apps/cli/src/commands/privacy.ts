/**
 * `agentlens privacy` (spec §16, §8) — surface privacy settings and data paths.
 *
 * M1 ships `paths` (print every data location) and `status` (active mode +
 * redaction toggles). `purge`/`export` are Phase 2/3 commands wired later.
 */
import { Command } from "commander";
import pc from "picocolors";
import { join } from "node:path";
import { configPath, databasePath, DATA_SUBDIRS, loadConfig } from "@agentlens/config";
import { resolveHome } from "../context.js";

export function makePrivacyCommand(): Command {
  const cmd = new Command("privacy").description("Inspect privacy settings and data locations.");

  cmd
    .command("paths")
    .description("Print every AgentLens data location on this machine.")
    .action(() => {
      const home = resolveHome();
      process.stdout.write(pc.bold(pc.cyan("AgentLens data locations\n")));
      process.stdout.write(`  home:   ${home}\n`);
      process.stdout.write(`  config: ${configPath(home)}\n`);
      process.stdout.write(`  db:     ${databasePath(home)}\n`);
      for (const sub of DATA_SUBDIRS) {
        process.stdout.write(`  ${sub.padEnd(7)} ${join(home, sub)}\n`);
      }
    });

  cmd
    .command("status")
    .description("Print the active privacy mode and redaction settings.")
    .action(async () => {
      const config = await loadConfig(resolveHome());
      const p = config.privacy;
      process.stdout.write(pc.bold(pc.cyan("Privacy status\n")));
      process.stdout.write(`  mode:                    ${p.mode}\n`);
      process.stdout.write(`  retentionDays:           ${p.retentionDays}\n`);
      process.stdout.write(`  redactEmails:            ${p.redactEmails}\n`);
      process.stdout.write(`  redactHomePath:          ${p.redactHomePath}\n`);
      process.stdout.write(`  storeAssistantResponses: ${p.storeAssistantResponses}\n`);
      process.stdout.write(`  customPatterns:          ${p.customPatterns.length}\n`);
      process.stdout.write(
        pc.dim("  Secrets, auth headers, and API keys are never persisted in any mode.\n"),
      );
    });

  return cmd;
}
