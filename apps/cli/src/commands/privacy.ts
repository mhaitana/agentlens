/**
 * `agentlens privacy` (spec §16, §8) — inspect privacy settings, data
 * locations, and exercise the local deletion controls (purge + retention-aware
 * export). Everything here is local-first: purge deletes rows from the local
 * SQLite DB only; export writes a JSON file under `<home>/exports/`. No data
 * ever leaves the machine.
 *
 * Subcommands: `paths`, `status`, `purge [--project <id>]`, `export`, `retain`.
 */
import { Command } from "commander";
import pc from "picocolors";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { configPath, databasePath, DATA_SUBDIRS, loadConfig } from "@agentlens/config";
import {
  purgeAllData,
  purgeProjectData,
  pruneExpiredSessions,
  schema,
  eq,
} from "@agentlens/database";
import { resolveHome, openAgentLensDb, closeDatabase } from "../context.js";

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

  cmd
    .command("purge")
    .description(
      "Delete all imported data (or one project's data with --project). " +
        "Config and schema are kept. This is irreversible.",
    )
    .option("--project <id>", "Restrict the purge to a single project id.")
    .option("--json", "Emit machine-readable JSON.")
    .action(async (opts: { project?: string; json?: boolean }) => {
      const home = resolveHome();
      const db = await openAgentLensDb(home);
      try {
        if (opts.project) {
          // Resolve the project's display name for a friendlier report.
          const projRows = await db.db
            .select({ displayName: schema.projects.displayName })
            .from(schema.projects)
            .where(eq(schema.projects.id, opts.project));
          const projName = projRows[0]?.displayName;
          const summary = await purgeProjectData(db.db, opts.project);
          if (opts.json) {
            process.stdout.write(
              JSON.stringify(
                { purged: true, scope: "project", projectId: opts.project, summary },
                null,
                2,
              ) + "\n",
            );
          } else {
            process.stdout.write(pc.green(`Purged project ${opts.project}\n`));
            if (projName) process.stdout.write(pc.dim(`  (${projName})\n`));
            process.stdout.write(
              `  sessions:       ${summary.sessions}\n` +
                `  events:          ${summary.events}\n` +
                `  recommendations: ${summary.recommendations}\n`,
            );
          }
          return;
        }
        const summary = await purgeAllData(db.db);
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ purged: true, scope: "all", summary }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(pc.green("Purged all imported data.\n"));
          process.stdout.write(
            `  sessions:       ${summary.sessions}\n` +
              `  events:          ${summary.events}\n` +
              `  projects:        ${summary.projects}\n` +
              `  recommendations: ${summary.recommendations}\n`,
          );
        }
      } finally {
        closeDatabase(db);
      }
    });

  cmd
    .command("retain")
    .description("Prune sessions older than the configured retention window (retentionDays).")
    .option("--json", "Emit machine-readable JSON.")
    .action(async (opts: { json?: boolean }) => {
      const home = resolveHome();
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      try {
        const pruned = await pruneExpiredSessions(
          db.db,
          config.privacy.retentionDays,
          new Date().toISOString(),
        );
        if (opts.json) {
          process.stdout.write(
            JSON.stringify({ pruned, retentionDays: config.privacy.retentionDays }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(
            pc.green(`Retention prune complete: ${pruned} session(s) removed.\n`) +
              pc.dim(`  (window: ${config.privacy.retentionDays} days)\n`),
          );
        }
      } finally {
        closeDatabase(db);
      }
    });

  cmd
    .command("export")
    .description("Export all stored data as a JSON file under <home>/exports/.")
    .option("--json", "Print the export metadata as JSON instead of a summary line.")
    .action(async (opts: { json?: boolean }) => {
      const home = resolveHome();
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      try {
        const sessions = await db.db.select().from(schema.sessions);
        const projects = await db.db.select().from(schema.projects);
        const recommendations = await db.db.select().from(schema.recommendations);
        const payload = {
          exportedAt: new Date().toISOString(),
          privacyMode: config.privacy.mode,
          retentionDays: config.privacy.retentionDays,
          sessions,
          projects,
          recommendations,
        };
        const exportsDir = join(home, "exports");
        await mkdir(exportsDir, { recursive: true });
        // Restrictive permissions on the export (best-effort, §19.1).
        const stamp = payload.exportedAt.replace(/[:.]/g, "-");
        const file = join(exportsDir, `agentlens-export-${stamp}.json`);
        await writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
        if (opts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                exportedAt: payload.exportedAt,
                file,
                sessions: sessions.length,
                projects: projects.length,
                recommendations: recommendations.length,
              },
              null,
              2,
            ) + "\n",
          );
        } else {
          process.stdout.write(pc.green(`Exported ${sessions.length} session(s) to:\n  ${file}\n`));
          process.stdout.write(pc.dim(`  privacy mode: ${config.privacy.mode}\n`));
        }
      } finally {
        closeDatabase(db);
      }
    });

  return cmd;
}
