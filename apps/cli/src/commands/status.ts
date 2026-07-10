/**
 * `agentlens status` (spec §16) — print the data home, config, DB path, and
 * row counts so the user can see what AgentLens currently holds locally.
 */
import { Command } from "commander";
import pc from "picocolors";
import { configPath, databasePath, loadConfig } from "@agentlens/config";
import { schema, count } from "@agentlens/database";
import { resolveHome, openAgentLensDb, closeDatabase } from "../context.js";

export function makeStatusCommand(): Command {
  return new Command("status")
    .description("Print the AgentLens local status: paths and database row counts.")
    .action(async () => {
      const home = resolveHome();
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      try {
        const [sessions, projects, sources, modelRequests, toolCalls] = await Promise.all([
          db.db.select({ n: count() }).from(schema.sessions),
          db.db.select({ n: count() }).from(schema.projects),
          db.db.select({ n: count() }).from(schema.sources),
          db.db.select({ n: count() }).from(schema.modelRequests),
          db.db.select({ n: count() }).from(schema.toolCalls),
        ]);

        process.stdout.write(pc.bold(pc.cyan("AgentLens status\n")));
        process.stdout.write(`  home:        ${home}\n`);
        process.stdout.write(`  config:      ${configPath(home)}\n`);
        process.stdout.write(`  db:          ${databasePath(home)}\n`);
        process.stdout.write(`  privacy mode: ${config.privacy.mode}\n`);
        process.stdout.write(pc.bold(pc.cyan("Database\n")));
        process.stdout.write(`  sources:        ${sources[0]?.n ?? 0}\n`);
        process.stdout.write(`  projects:       ${projects[0]?.n ?? 0}\n`);
        process.stdout.write(`  sessions:       ${sessions[0]?.n ?? 0}\n`);
        process.stdout.write(`  model requests: ${modelRequests[0]?.n ?? 0}\n`);
        process.stdout.write(`  tool calls:     ${toolCalls[0]?.n ?? 0}\n`);
      } finally {
        closeDatabase(db);
      }
    });
}
