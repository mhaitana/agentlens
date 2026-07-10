#!/usr/bin/env node
/**
 * @agentlens/cli — the `agentlens` command-line entry point (spec §11, §13.4).
 *
 * This is the Milestone-1 thin shell: it wires the import, analysis,
 * recommendations, and reporting packages behind a Commander program. The
 * real subcommands (`import`, `scan`, `recommend`, `report`, `serve`, `config`)
 * are implemented in feature F006/F008; for INFRA-001 this just proves the
 * binary builds and runs.
 */
import { Command } from "commander";

const program = new Command();

program
  .name("agentlens")
  .description("Local-first, privacy-first analytics & coaching for Claude Code.")
  .version("0.0.0");

program
  .command("status")
  .description("Print the AgentLens foundation status (INFRA-001 placeholder).")
  .action(() => {
    process.stdout.write("AgentLens foundation ready.\n");
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
