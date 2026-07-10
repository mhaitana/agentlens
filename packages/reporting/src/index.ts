/**
 * @agentlens/reporting — renders an {@link AnalyticsSnapshot} into terminal,
 * Markdown, and JSON reports (spec §11, §13.7).
 *
 * Depends only on `@agentlens/domain` (the snapshot type) and a couple of
 * formatting libs (cli-table3, picocolors). It never touches the database or a
 * source adapter, so it is trivially testable from a synthetic snapshot.
 */

export const REPORTING_VERSION = "0.1.0";

export type ReportFormat = "terminal" | "markdown" | "json";

export { renderTerminal } from "./terminal.js";
export { renderMarkdown } from "./markdown.js";
export { renderJson } from "./json.js";

export {
  COST_ESTIMATE_LABEL,
  describePeriod,
  formatNumber,
  formatDuration,
  formatUsd,
  formatPv,
  formatPvCount,
  provenanceTag,
  recommendationLine,
} from "./format.js";

import { renderTerminal } from "./terminal.js";
import { renderMarkdown } from "./markdown.js";
import { renderJson } from "./json.js";
import type { AnalyticsSnapshot } from "@agentlens/domain";

/**
 * Render a snapshot in the requested format. Unknown formats fall back to a
 * thrown error so the CLI can surface a clear message.
 */
export function renderReport(snapshot: AnalyticsSnapshot, format: ReportFormat): string {
  switch (format) {
    case "terminal":
      return renderTerminal(snapshot);
    case "markdown":
      return renderMarkdown(snapshot);
    case "json":
      return renderJson(snapshot);
    default:
      throw new Error(`Unknown report format: ${String(format)}`);
  }
}
