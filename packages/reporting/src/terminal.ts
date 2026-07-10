/**
 * Terminal report renderer (spec §13.7).
 *
 * Renders an {@link AnalyticsSnapshot} as ANSI-coloured text with cli-table3
 * tables. picocolors respects `NO_COLOR` and non-interactive terminals, so no
 * escape codes leak when colour is disabled (§16, §19).
 */

import Table from "cli-table3";
import pc from "picocolors";
import type { AnalyticsSnapshot } from "@agentlens/domain";
import {
  COST_ESTIMATE_LABEL,
  costLine,
  describePeriod,
  formatDuration,
  formatNumber,
  formatPv,
  formatPvCount,
  formatUsd,
  recommendationLine,
} from "./format.js";

/**
 * cli-table3's `style.head`/`style.border` colour arrays bypass NO_COLOR (they
 * emit ANSI directly, independent of picocolors). Gate the whole table style on
 * picocolors' own `isColorSupported` so NO_COLOR / non-TTY streams get plain
 * tables with no escape codes (§16, §19).
 */
const tableStyle = pc.isColorSupported
  ? { head: ["cyan"], border: ["gray"] }
  : { head: [] as string[], border: [] as string[] };

/** Render the full snapshot as a terminal string. */
export function renderTerminal(snapshot: AnalyticsSnapshot): string {
  const out: string[] = [];
  const h = (s: string): string => pc.bold(pc.cyan(s));

  // --- Summary -----------------------------------------------------------
  out.push(h("AgentLens report"));
  out.push(h("Summary"));
  out.push(`Window: ${describePeriod(snapshot)}  ·  generated ${snapshot.generatedAt}`);
  out.push(
    `Sessions: ${formatPvCount(snapshot.usage.totalSessions)}  ·  Privacy: ${snapshot.privacyMode}`,
  );
  out.push(`Cost: ${costLine(snapshot)}`);
  out.push("");

  // --- Usage -------------------------------------------------------------
  out.push(h("Usage"));
  const usage = snapshot.usage;
  out.push(`  Sessions/day:    ${formatPv(usage.sessionsPerDay)}`);
  out.push(`  Sessions/week:   ${formatPv(usage.sessionsPerWeek)}`);
  out.push(`  Sessions/month:  ${formatPv(usage.sessionsPerMonth)}`);
  out.push(`  Active days:     ${formatPv(usage.activeDays)}`);
  out.push(`  Median duration: ${formatPv(usage.medianSessionDurationMs, formatDuration)}`);
  out.push(`  Mean duration:   ${formatPv(usage.meanSessionDurationMs, formatDuration)}`);
  out.push(`  Total duration:  ${formatPv(usage.totalDurationMs, formatDuration)}`);
  out.push(`  Prompts/session: ${formatPv(usage.promptsPerSession)}`);
  out.push(`  Tool calls/session: ${formatPv(usage.toolCallsPerSession)}`);
  out.push(
    `  Tool success rate:  ${formatPv(usage.toolSuccessRate, (v) => `${(v * 100).toFixed(1)}%`)}`,
  );
  out.push(`  Total tokens:    ${formatPv(usage.totalTokens)}`);
  out.push(`    input:         ${formatPv(usage.inputTokens)}`);
  out.push(`    output:        ${formatPv(usage.outputTokens)}`);
  out.push(`    cache read:    ${formatPv(usage.cacheReadTokens)}`);
  out.push(`    cache write:   ${formatPv(usage.cacheCreationTokens)}`);
  out.push(`  Compactions:     ${formatPvCount(usage.totalCompactions)}`);
  out.push(`  Subagent sessions: ${formatPvCount(usage.totalSubagentSessions)}`);
  if (usage.modelUsage.length > 0) {
    const t = new Table({
      head: ["Model", "Sessions", "Requests", "In", "Out", "Cache R", "Est. cost"],
      style: tableStyle,
    });
    for (const m of usage.modelUsage) {
      t.push([
        m.modelId,
        formatNumber(m.sessions),
        formatNumber(m.modelRequests),
        formatNumber(m.inputTokens),
        formatNumber(m.outputTokens),
        formatNumber(m.cacheReadTokens),
        formatUsd(m.estimatedCostUsd),
      ]);
    }
    out.push("", t.toString());
  }
  out.push("");

  // --- Most important findings / Top recommendations ----------------------
  out.push(h("Most important findings"));
  if (snapshot.recommendations.length === 0) {
    out.push(pc.dim("  No recommendations yet. The rule engine ships rules in M2."));
  } else {
    for (const r of snapshot.recommendations.slice(0, 5)) out.push(`  ${recommendationLine(r)}`);
  }
  out.push("");

  // --- Verification quality ---------------------------------------------
  out.push(h("Verification quality"));
  const w = snapshot.workflow;
  out.push(`  Verification runs:                  ${formatPvCount(w.totalVerificationRuns)}`);
  out.push(
    `  Sessions ending after success:     ${formatPvCount(w.sessionsEndingAfterSuccessfulVerification)}`,
  );
  out.push(
    `  Sessions ending with known failures: ${formatPvCount(w.sessionsEndingWithKnownFailures)}`,
  );
  out.push(
    `  Changes after final verification:   ${formatPvCount(w.changesAfterFinalVerification)}`,
  );
  out.push(`  Corrective prompts:                 ${formatPvCount(w.correctivePromptCount)}`);
  out.push(
    `  Median time to first edit:          ${formatPv(w.medianTimeToFirstEditMs, formatDuration)}`,
  );
  out.push(
    `  Median edit→verification gap:      ${formatPv(w.medianTimeBetweenFinalEditAndVerificationMs, formatDuration)}`,
  );
  out.push("");

  // --- Tool efficiency ---------------------------------------------------
  out.push(h("Tool efficiency"));
  const tools = snapshot.tools;
  if (tools.mostUsedTools.length > 0) {
    const t = new Table({
      head: ["Tool", "Calls", "Failures", "Fail rate", "Avg ms"],
      style: tableStyle,
    });
    for (const r of tools.mostUsedTools) {
      t.push([
        r.toolName,
        formatNumber(r.calls),
        formatNumber(r.failures),
        `${(r.failureRate * 100).toFixed(1)}%`,
        r.averageDurationMs === null ? "—" : formatNumber(r.averageDurationMs),
      ]);
    }
    out.push(t.toString());
  }
  out.push(
    `  Overall tool failure rate: ${formatPv(tools.toolFailureRate, (v) => `${(v * 100).toFixed(1)}%`)}`,
  );
  out.push(`  Average tool duration:    ${formatPv(tools.averageToolDurationMs, formatDuration)}`);
  out.push(`  Largest tool input (B):   ${formatPv(tools.largestToolInputsBytes)}`);
  out.push(`  Largest tool output (B):   ${formatPv(tools.largestToolOutputsBytes)}`);
  out.push(`  Test commands:             ${formatPvCount(tools.testCommandFrequency)}`);
  out.push(`  Build commands:            ${formatPvCount(tools.buildCommandFrequency)}`);
  for (const kind of [
    "repeatedReads",
    "repeatedSearches",
    "repeatedCommands",
    "repeatedFailedCommands",
  ] as const) {
    const rows = tools[kind];
    if (rows.length > 0) {
      out.push(`  ${pc.dim(kind + ":")}`);
      for (const r of rows) out.push(`    ${r.label} ×${r.occurrences} (${r.sessions} sessions)`);
    }
  }
  out.push("");

  // --- Data completeness --------------------------------------------------
  out.push(h("Data completeness"));
  const c = snapshot.completeness;
  out.push(
    `  Sessions: ${formatNumber(c.totalSessions)}  ·  complete: ${formatNumber(c.complete)}  ·  tail-missing: ${formatNumber(c.partialTailMissing)}  ·  metrics-missing: ${formatNumber(c.partialMetricsMissing)}  ·  prompts-missing: ${formatNumber(c.partialPromptsMissing)}`,
  );
  const cm = snapshot.completion;
  out.push(
    `  Completion: completed ${formatNumber(cm.completed)} · interrupted ${formatNumber(cm.interrupted)} · failed ${formatNumber(cm.failed)} · unknown ${formatNumber(cm.unknown)}`,
  );
  out.push("");

  // --- Top recommendations (full list) -----------------------------------
  out.push(h("Top recommendations"));
  if (snapshot.recommendations.length === 0) {
    out.push(pc.dim("  (none)"));
  } else {
    for (const r of snapshot.recommendations) out.push(`  ${recommendationLine(r)}`);
  }
  out.push("");

  // --- Privacy mode ------------------------------------------------------
  out.push(h("Privacy mode"));
  out.push(`  ${snapshot.privacyMode}`);
  out.push("");

  // --- Scan provenance ---------------------------------------------------
  out.push(h("Scan provenance"));
  const sp = snapshot.scanProvenance;
  out.push(`  Source:      ${sp.sourceId}`);
  out.push(`  Adapter:     ${sp.adapterVersion ?? "—"}`);
  out.push(`  Parser:      v${sp.parserVersion ?? "—"}`);
  out.push(
    `  Imported:    ${formatNumber(sp.importedSessions)}  ·  Skipped: ${formatNumber(sp.skippedSessions)}`,
  );
  out.push("");

  out.push(pc.dim(`Cost figures: ${COST_ESTIMATE_LABEL}.`));
  return out.join("\n");
}
