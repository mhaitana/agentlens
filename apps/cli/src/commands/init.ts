/**
 * `agentlens init` (spec §16, §7) — non-interactively create the data home,
 * write a default config, and initialise the SQLite database. Prints the
 * resolved paths so the user can verify where AgentLens stores its data.
 *
 * Idempotent: running it again is a no-op (existing config/DB are preserved).
 */
import { Command } from "commander";
import pc from "picocolors";
import { ensureDataDirs, configPath, databasePath, loadConfig } from "@agentlens/config";
import { resolveHome, openAgentLensDb, closeDatabase } from "../context.js";

export function makeInitCommand(): Command {
  return new Command("init")
    .description("Initialise the AgentLens data home, config, and database (non-interactive).")
    .action(async () => {
      const home = resolveHome();
      await ensureDataDirs(home);
      // loadConfig writes a default config.json if none exists (§9).
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      closeDatabase(db);

      process.stdout.write(pc.bold(pc.cyan("AgentLens initialised.\n")));
      process.stdout.write(`  home:   ${home}\n`);
      process.stdout.write(`  config: ${configPath(home)}\n`);
      process.stdout.write(`  db:     ${databasePath(home)}\n`);
      process.stdout.write(`  privacy mode: ${config.privacy.mode}\n`);
      process.stdout.write(
        pc.dim("  Next: run `agentlens scan` to import Claude Code transcripts.\n"),
      );
    });
}
