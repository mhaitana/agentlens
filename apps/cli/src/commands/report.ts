/**
 * `agentlens report` (spec §16, §13.7) — compute the analytics snapshot for a
 * report window and render it as terminal, Markdown, or JSON.
 *
 * Options: `--period day|week|month|all` (default week), `--project <path>`,
 * `--session <id>`, `--format terminal|markdown|json`, `--output <file>`.
 * Cost figures are always labelled "Estimated — not an official billing value".
 */
import { Command } from "commander";
import pc from "picocolors";
import { writeFile } from "node:fs/promises";
import type { ReportFilters, ReportPeriod, ModelCatalogueEntry } from "@agentlens/domain";
import { computeAnalytics, defaultRules, buildModelCatalogue } from "@agentlens/analysis-engine";
import type { RuleOverrides } from "@agentlens/analysis-engine";
import { renderReport, COST_ESTIMATE_LABEL, type ReportFormat } from "@agentlens/reporting";
import { redactPath } from "@agentlens/redaction";
import { ProjectRepo } from "@agentlens/database";
import { resolveHome, openAgentLensDb, closeDatabase, loadConfig } from "../context.js";
import { buildPrivacy } from "../import/index.js";
import { buildConfigurationSummary } from "@agentlens/config";

const PERIODS: ReportPeriod[] = ["day", "week", "month", "all"];

function parsePeriod(value: string): ReportPeriod {
  if (!PERIODS.includes(value as ReportPeriod)) {
    throw new Error(`Invalid --period "${value}". Expected one of: ${PERIODS.join(", ")}`);
  }
  return value as ReportPeriod;
}

export function makeReportCommand(): Command {
  return new Command("report")
    .description("Render an analytics report from the local database.")
    .option("--period <p>", "Report window: day, week, month, or all.", "week")
    .option("--project <path>", "Restrict the report to a single project path.")
    .option("--session <id>", "Restrict the report to a single session id.")
    .option("--format <fmt>", "Output format: terminal, markdown, or json.", "terminal")
    .option("--output <file>", "Write the report to a file instead of stdout.")
    .action(async (opts: ReportOpts) => {
      const period = parsePeriod(opts.period ?? "week");
      const format = (opts.format ?? "terminal") as ReportFormat;
      if (!["terminal", "markdown", "json"].includes(format)) {
        throw new Error(`Invalid --format "${opts.format}". Expected: terminal, markdown, json`);
      }

      const home = resolveHome();
      const config = await loadConfig(home);
      const db = await openAgentLensDb(home);
      try {
        const filters: ReportFilters = { period };

        // Resolve --project (a path) to a project id via the same path-hash
        // used at import time, so the report filters match persisted rows.
        if (opts.project) {
          const privacy = buildPrivacy({
            mode: config.privacy.mode,
            redactEmails: config.privacy.redactEmails,
            redactHomePath: config.privacy.redactHomePath,
            customPatterns: config.privacy.customPatterns,
            repoPath: opts.project,
          });
          const pathHash = redactPath(opts.project, privacy.options).pathHash;
          const project = await new ProjectRepo(db.db).getByPathHash("claude-code", pathHash);
          if (!project) {
            throw new Error(
              `No imported project matches path "${opts.project}". Run \`agentlens scan\` first.`,
            );
          }
          filters.projectId = project.id;
        }
        if (opts.session) filters.sessionId = opts.session;

        const snapshot = await computeAnalytics(db.db, filters, {
          minimumRecommendationConfidence: config.analysis.minimumRecommendationConfidence,
          privacyMode: config.privacy.mode,
          rules: defaultRules(),
          // Config overrides are a loose record; the engine tolerates partial /
          // unknown shapes (it only reads `enabled` and `thresholds`).
          ruleOverrides: config.analysis.ruleOverrides as RuleOverrides,
          // §15.4 model catalogue (user overrides merged over bundled defaults).
          modelCatalogue: buildModelCatalogue(
            config.analysis.modelCatalogue as ModelCatalogueEntry[],
          ),
          // §15.4 configuration-state summary for configuration-category rules.
          configurationSummary: buildConfigurationSummary(config),
        });

        const rendered = renderReport(snapshot, format);
        if (opts.output) {
          await writeFile(opts.output, rendered + "\n", "utf8");
          process.stdout.write(pc.dim(`Report written to ${opts.output}\n`));
        } else {
          process.stdout.write(rendered + "\n");
          // Surface the cost disclaimer on the terminal stream for visibility;
          // the renderers also embed it inline.
          if (format === "terminal") {
            process.stdout.write(pc.dim(`Cost figures: ${COST_ESTIMATE_LABEL}.\n`));
          }
        }
      } finally {
        closeDatabase(db);
      }
    });
}

interface ReportOpts {
  period?: string;
  project?: string;
  session?: string;
  format?: string;
  output?: string;
}
