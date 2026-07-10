#!/usr/bin/env node
/**
 * @agentlens/cli — the `agentlens` command-line entry point (spec §11, §16).
 *
 * Wires the import pipeline, analytics engine, and reporting renderers behind
 * a Commander program. Commands are defined in `./commands/*` and assembled
 * here so each subcommand stays independently testable.
 */
import { Command } from "commander";
import { CLI_VERSION } from "./commands/version.js";
import { makeInitCommand } from "./commands/init.js";
import { makeScanCommand } from "./commands/scan.js";
import { makeReportCommand } from "./commands/report.js";
import { makeConfigCommand } from "./commands/config.js";
import { makePrivacyCommand } from "./commands/privacy.js";
import { makeRulesCommand } from "./commands/rules.js";
import { makeStatusCommand } from "./commands/status.js";
import { makeVersionCommand } from "./commands/version.js";
import { makeDashboardCommand } from "./commands/dashboard.js";

const program = new Command();

program
  .name("agentlens")
  .description("Local-first, privacy-first analytics & coaching for Claude Code.")
  .version(CLI_VERSION);

program.addCommand(makeInitCommand());
program.addCommand(makeScanCommand());
program.addCommand(makeReportCommand());
program.addCommand(makeConfigCommand());
program.addCommand(makePrivacyCommand());
program.addCommand(makeRulesCommand());
program.addCommand(makeStatusCommand());
program.addCommand(makeDashboardCommand());
program.addCommand(makeVersionCommand());

program.parseAsync(process.argv).catch((err: unknown) => {
  // Commander error messages are already user-facing; surface others clearly.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(process.exitCode || 2);
});
