/**
 * `agentlens scan` (spec §16, §13.1–13.3) — discover Claude Code transcripts,
 * stream-parse + normalise, redact-at-boundary, and persist sessions/events
 * transactionally. Supports `--dry-run`, `--force`, `--path`, `--project`,
 * `--since`/`--until` time bounds, and `--json` machine output.
 *
 * Privacy: when `--path` is given, the real `~/.claude` is pointed at a
 * guaranteed-empty override dir so only `--path` is ever read (§21). Redaction
 * always runs before persistence (§8.4).
 */
import { Command } from "commander";
import pc from "picocolors";
import type { DiscoveryContext } from "@agentlens/source-adapter";
import { runPipeline, buildPrivacy, type PipelineResult } from "../import/index.js";
import { pruneExpiredSessions } from "@agentlens/database";
import {
  resolveHome,
  openAgentLensDb,
  buildAdapter,
  closeDatabase,
  loadConfig,
} from "../context.js";

/** Shape of the `--json` output. */
interface ScanJsonSummary {
  discovered: number;
  imported: number;
  skipped: number;
  pruned: number;
  files: Array<{ uri: string; skipped: boolean; reason: string; diagnostics: number }>;
}

function toSummary(result: PipelineResult, pruned: number): ScanJsonSummary {
  return {
    discovered: result.discovered,
    imported: result.imported,
    skipped: result.skipped,
    pruned,
    files: result.files.map((f) => ({
      uri: f.uri,
      skipped: f.decision.skip,
      reason: f.decision.reason,
      diagnostics: f.diagnostics.length,
    })),
  };
}

export function makeScanCommand(): Command {
  return new Command("scan")
    .description("Discover and import Claude Code transcripts into the local database.")
    .option("--dry-run", "Parse and report what would be imported without persisting.")
    .option("--force", "Re-import every discovered file even if unchanged.")
    .option("--path <dir>", "Scan an additional directory instead of ~/.claude.")
    .option("--project <path>", "Restrict the scan to a single project path.")
    .option("--since <iso>", "Only include events at or after this ISO timestamp.")
    .option("--until <iso>", "Only include events at or before this ISO timestamp.")
    .option("--json", "Emit machine-readable JSON to stdout.")
    .action(async (opts: ScanOpts) => {
      const home = resolveHome();
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      try {
        const onlyPath = Boolean(opts.path);
        const adapter = buildAdapter(home, onlyPath);

        const discovery: DiscoveryContext = {
          additionalDirectories: opts.path
            ? [opts.path]
            : config.sources.claudeCode.transcriptDirectories,
          excludedProjects: config.sources.claudeCode.excludedProjects,
          followSymlinks: config.sources.claudeCode.followSymlinks,
        };

        const privacy = buildPrivacy({
          mode: config.privacy.mode,
          redactEmails: config.privacy.redactEmails,
          redactHomePath: config.privacy.redactHomePath,
          customPatterns: config.privacy.customPatterns,
          repoPath: opts.path,
        });

        const since = opts.since ? new Date(opts.since) : undefined;
        const until = opts.until ? new Date(opts.until) : undefined;
        if (since && Number.isNaN(since.getTime())) {
          throw new Error(`Invalid --since value: ${opts.since}`);
        }
        if (until && Number.isNaN(until.getTime())) {
          throw new Error(`Invalid --until value: ${opts.until}`);
        }

        const result = await runPipeline({
          database: db,
          adapter,
          privacy,
          discovery,
          since,
          until,
          project: opts.project,
          dryRun: Boolean(opts.dryRun),
          force: Boolean(opts.force),
          onProgress: opts.json
            ? undefined
            : (p) => {
                if (p.phase === "persist" && !p.done) return; // per-file noise
                if (p.uri) process.stdout.write(`  ${pc.dim(p.phase)} ${p.uri}\n`);
              },
        });

        // Enforce retention: prune sessions older than the configured window
        // (§8 "configurable retention", §13.11 "Retention and deletion work").
        // Skipped in --dry-run (no data was written) and when retention is off.
        let pruned = 0;
        if (!opts.dryRun) {
          pruned = await pruneExpiredSessions(
            db.db,
            config.privacy.retentionDays,
            new Date().toISOString(),
          );
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify(toSummary(result, pruned), null, 2) + "\n");
        } else {
          process.stdout.write(
            pc.bold(
              pc.cyan(
                `${opts.dryRun ? "Dry run: " : ""}Scan complete — ` +
                  `${result.discovered} discovered, ${result.imported} imported, ${result.skipped} skipped.\n`,
              ),
            ),
          );
          if (pruned > 0) {
            process.stdout.write(
              pc.dim(
                `  Retention: pruned ${pruned} session(s) older than ${config.privacy.retentionDays} day(s).\n`,
              ),
            );
          }
          const diags = result.files.flatMap((f) => f.diagnostics);
          if (diags.length > 0) {
            process.stdout.write(
              pc.yellow(`  ${diags.length} parser diagnostic(s) — run with --json for details.\n`),
            );
          }
        }
      } finally {
        closeDatabase(db);
      }
    });
}

interface ScanOpts {
  dryRun?: boolean;
  force?: boolean;
  path?: string;
  project?: string;
  since?: string;
  until?: string;
  json?: boolean;
}
