/**
 * `agentlens version` (spec §16) — prints the CLI + engine versions.
 */
import { Command } from "commander";
import { ANALYSIS_ENGINE_VERSION } from "@agentlens/analysis-engine";
import { REPORTING_VERSION } from "@agentlens/reporting";
import { ADAPTER_VERSION } from "@agentlens/claude-adapter";

/** CLI package version (kept in sync with package.json at release time). */
export const CLI_VERSION = "0.1.0";

export function makeVersionCommand(): Command {
  return new Command("version")
    .description("Print the AgentLens CLI and engine versions.")
    .action(() => {
      process.stdout.write(
        `agentlens ${CLI_VERSION}\n  adapter:        ${ADAPTER_VERSION}\n  analysis-engine: ${ANALYSIS_ENGINE_VERSION}\n  reporting:      ${REPORTING_VERSION}\n`,
      );
    });
}
