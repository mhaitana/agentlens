/**
 * Markdown report renderer (spec §13.7).
 *
 * Plain markdown — no ANSI escapes — suitable for `--output` files and
 * copy-paste. Carries the cost-estimate disclaimer wherever a cost appears.
 */

import type { AnalyticsSnapshot, ProvenancedValue } from "@agentlens/domain";
import {
  COST_ESTIMATE_LABEL,
  describePeriod,
  formatDuration,
  formatNumber,
  formatPvCount,
  formatUsd,
  recommendationLine,
} from "./format.js";

function mdPv<T extends number | null>(
  pv: ProvenancedValue<T>,
  format: (v: T) => string = (v) => (typeof v === "number" ? formatNumber(v) : "—"),
): string {
  if (pv.value === null || pv.value === undefined) return "—";
  const body = format(pv.value);
  return pv.provenance === "exact" ? body : `${body} *(${pv.provenance})*`;
}

/** Render the full snapshot as a markdown string. */
export function renderMarkdown(snapshot: AnalyticsSnapshot): string {
  const out: string[] = [];
  out.push(`# AgentLens report`);
  out.push("");
  out.push(`- **Window:** ${describePeriod(snapshot)}`);
  out.push(`- **Generated:** ${snapshot.generatedAt}`);
  out.push(`- **Sessions:** ${formatPvCount(snapshot.usage.totalSessions)}`);
  out.push(`- **Privacy mode:** ${snapshot.privacyMode}`);
  const usd = snapshot.cost.totalUsd.value;
  out.push(
    `- **Cost:** ${usd === null || usd === undefined ? "—" : formatUsd(usd)} *(${COST_ESTIMATE_LABEL})*`,
  );
  out.push("");

  // Usage
  out.push(`## Usage`);
  const u = snapshot.usage;
  out.push("");
  out.push(`| Metric | Value |`);
  out.push(`| --- | --- |`);
  out.push(`| Sessions / day | ${mdPv(u.sessionsPerDay)} |`);
  out.push(`| Sessions / week | ${mdPv(u.sessionsPerWeek)} |`);
  out.push(`| Sessions / month | ${mdPv(u.sessionsPerMonth)} |`);
  out.push(`| Active days | ${mdPv(u.activeDays)} |`);
  out.push(`| Median session duration | ${mdPv(u.medianSessionDurationMs, formatDuration)} |`);
  out.push(`| Mean session duration | ${mdPv(u.meanSessionDurationMs, formatDuration)} |`);
  out.push(`| Total duration | ${mdPv(u.totalDurationMs, formatDuration)} |`);
  out.push(`| Prompts / session | ${mdPv(u.promptsPerSession)} |`);
  out.push(`| Tool calls / session | ${mdPv(u.toolCallsPerSession)} |`);
  out.push(`| Tool success rate | ${mdPv(u.toolSuccessRate, (v) => `${(v * 100).toFixed(1)}%`)} |`);
  out.push(`| Total tokens | ${mdPv(u.totalTokens)} |`);
  out.push(`| Input tokens | ${mdPv(u.inputTokens)} |`);
  out.push(`| Output tokens | ${mdPv(u.outputTokens)} |`);
  out.push(`| Cache read tokens | ${mdPv(u.cacheReadTokens)} |`);
  out.push(`| Cache creation tokens | ${mdPv(u.cacheCreationTokens)} |`);
  out.push(`| Compactions | ${mdPv(u.totalCompactions)} |`);
  out.push(`| Subagent sessions | ${mdPv(u.totalSubagentSessions)} |`);
  if (u.modelUsage.length > 0) {
    out.push("");
    out.push(`| Model | Sessions | Requests | In | Out | Cache R | Est. cost |`);
    out.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    for (const m of u.modelUsage) {
      out.push(
        `| ${m.modelId} | ${m.sessions} | ${m.modelRequests} | ${formatNumber(m.inputTokens)} | ${formatNumber(m.outputTokens)} | ${formatNumber(m.cacheReadTokens)} | ${formatUsd(m.estimatedCostUsd)} |`,
      );
    }
  }
  out.push("");

  // Most important findings
  out.push(`## Most important findings`);
  out.push("");
  if (snapshot.recommendations.length === 0) {
    out.push(`_No recommendations yet. The rule engine ships rules in M2._`);
  } else {
    for (const r of snapshot.recommendations.slice(0, 5)) out.push(`- ${recommendationLine(r)}`);
  }
  out.push("");

  // Verification quality
  out.push(`## Verification quality`);
  out.push("");
  const w = snapshot.workflow;
  out.push(`| Metric | Value |`);
  out.push(`| --- | --- |`);
  out.push(`| Verification runs | ${mdPv(w.totalVerificationRuns)} |`);
  out.push(
    `| Sessions ending after success | ${mdPv(w.sessionsEndingAfterSuccessfulVerification)} |`,
  );
  out.push(`| Sessions ending with known failures | ${mdPv(w.sessionsEndingWithKnownFailures)} |`);
  out.push(`| Changes after final verification | ${mdPv(w.changesAfterFinalVerification)} |`);
  out.push(`| Corrective prompts | ${mdPv(w.correctivePromptCount)} |`);
  out.push(`| Median time to first edit | ${mdPv(w.medianTimeToFirstEditMs, formatDuration)} |`);
  out.push(
    `| Median edit→verification gap | ${mdPv(w.medianTimeBetweenFinalEditAndVerificationMs, formatDuration)} |`,
  );
  out.push("");

  // Tool efficiency
  out.push(`## Tool efficiency`);
  out.push("");
  const t = snapshot.tools;
  if (t.mostUsedTools.length > 0) {
    out.push(`| Tool | Calls | Failures | Fail rate | Avg ms |`);
    out.push(`| --- | --- | --- | --- | --- |`);
    for (const r of t.mostUsedTools) {
      out.push(
        `| ${r.toolName} | ${r.calls} | ${r.failures} | ${(r.failureRate * 100).toFixed(1)}% | ${r.averageDurationMs === null ? "—" : formatNumber(r.averageDurationMs)} |`,
      );
    }
    out.push("");
  }
  out.push(`| Metric | Value |`);
  out.push(`| --- | --- |`);
  out.push(
    `| Overall tool failure rate | ${mdPv(t.toolFailureRate, (v) => `${(v * 100).toFixed(1)}%`)} |`,
  );
  out.push(`| Average tool duration | ${mdPv(t.averageToolDurationMs, formatDuration)} |`);
  out.push(`| Largest tool input (B) | ${mdPv(t.largestToolInputsBytes)} |`);
  out.push(`| Largest tool output (B) | ${mdPv(t.largestToolOutputsBytes)} |`);
  out.push(`| Test commands | ${mdPv(t.testCommandFrequency)} |`);
  out.push(`| Build commands | ${mdPv(t.buildCommandFrequency)} |`);
  for (const kind of [
    "repeatedReads",
    "repeatedSearches",
    "repeatedCommands",
    "repeatedFailedCommands",
  ] as const) {
    const rows = t[kind];
    if (rows.length > 0) {
      out.push("");
      out.push(`**${kind}:**`);
      for (const r of rows) out.push(`- \`${r.label}\` ×${r.occurrences} (${r.sessions} sessions)`);
    }
  }
  out.push("");

  // Data completeness
  out.push(`## Data completeness`);
  out.push("");
  const c = snapshot.completeness;
  out.push(`| Status | Sessions |`);
  out.push(`| --- | --- |`);
  out.push(`| Complete | ${c.complete} |`);
  out.push(`| Partial — tail missing | ${c.partialTailMissing} |`);
  out.push(`| Partial — metrics missing | ${c.partialMetricsMissing} |`);
  out.push(`| Partial — prompts missing | ${c.partialPromptsMissing} |`);
  out.push("");
  const cm = snapshot.completion;
  out.push(
    `**Completion:** completed ${cm.completed} · interrupted ${cm.interrupted} · failed ${cm.failed} · unknown ${cm.unknown}`,
  );
  out.push("");

  // Top recommendations
  out.push(`## Top recommendations`);
  out.push("");
  if (snapshot.recommendations.length === 0) {
    out.push(`_(none)_`);
  } else {
    for (const r of snapshot.recommendations) out.push(`- ${recommendationLine(r)}`);
  }
  out.push("");

  // Privacy mode
  out.push(`## Privacy mode`);
  out.push("");
  out.push(`\`${snapshot.privacyMode}\``);
  out.push("");

  // Scan provenance
  out.push(`## Scan provenance`);
  out.push("");
  const sp = snapshot.scanProvenance;
  out.push(`| Field | Value |`);
  out.push(`| --- | --- |`);
  out.push(`| Source | ${sp.sourceId} |`);
  out.push(`| Adapter | ${sp.adapterVersion ?? "—"} |`);
  out.push(`| Parser | v${sp.parserVersion ?? "—"} |`);
  out.push(`| Imported | ${sp.importedSessions} |`);
  out.push(`| Skipped | ${sp.skippedSessions} |`);
  out.push("");

  out.push(`---`);
  out.push(`_Cost figures: ${COST_ESTIMATE_LABEL}._`);
  return out.join("\n");
}
