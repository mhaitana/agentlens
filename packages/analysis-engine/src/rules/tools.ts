/**
 * TOOLS-001..008 deterministic rules (spec §13.10, §15.4 tool efficiency).
 *
 * Each rule reads the normalised tool-behaviour metrics from the snapshot and
 * emits at most one candidate (the most significant finding). Confidence is a
 * deterministic function of the evidence; conservative where the spec demands.
 */
import type { RecommendationRule } from "@agentlens/domain";
import {
  candidate,
  confidenceForCount,
  evidence,
  instructionRemediation,
  metric,
  num,
  threshold,
} from "./helpers.js";

/** TOOLS-001 Repeated unchanged file reads. */
export function tools001(): RecommendationRule {
  return {
    id: "TOOLS-001",
    version: 1,
    category: "tools",
    defaultThresholds: { minOccurrences: 3 },
    async evaluate(ctx) {
      const rows = ctx.snapshot.tools.repeatedReads;
      if (rows.length === 0) return [];
      const min = threshold(ctx, "minOccurrences", 3);
      const top = rows[0];
      if (!top || top.occurrences < min) return [];
      const confidence = confidenceForCount(top.occurrences, 0.5, 0.08, 0.9);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-001",
          ruleVersion: 1,
          category: "tools",
          severity: "medium",
          confidence,
          title: "Repeated unchanged file reads",
          summary: `"${top.label}" read ${top.occurrences}× across ${top.sessions} session(s)`,
          explanation: `The same file was read repeatedly without a recorded intervening edit. Re-reading suggests the contents were not retained in context. ${rows.length > 1 ? `${rows.length} paths show this pattern; the busiest is shown.` : ""}`,
          evidence: [
            evidence("repeated-read", `Path "${top.label}" read ${top.occurrences} times`, [
              metric("occurrences", top.occurrences, "exact"),
              metric("sessions", top.sessions, "exact"),
              metric("intervening-modifications", 0, "unknown"),
            ]),
          ],
          remediation: instructionRemediation(
            "Read each file once and keep its contents in context, or use a targeted search/Edit instead of re-reading the whole file.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-002 Repeated equivalent command. */
export function tools002(): RecommendationRule {
  return {
    id: "TOOLS-002",
    version: 1,
    category: "tools",
    defaultThresholds: { minOccurrences: 3 },
    async evaluate(ctx) {
      const rows = ctx.snapshot.tools.repeatedCommands;
      if (rows.length === 0) return [];
      const min = threshold(ctx, "minOccurrences", 3);
      const top = rows[0];
      if (!top || top.occurrences < min) return [];
      // Conservative: cannot fully distinguish watch/polling at aggregate level.
      const confidence = confidenceForCount(top.occurrences, 0.45, 0.06, 0.75);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-002",
          ruleVersion: 1,
          category: "tools",
          severity: "low",
          confidence,
          title: "Repeated equivalent command",
          summary: `Command "${top.label}" run ${top.occurrences}× across ${top.sessions} session(s)`,
          explanation: `A normalised command recurred within a short period. Legitimate watch/polling commands are not distinguished at this evidence level; review whether these were necessary.`,
          evidence: [
            evidence("repeated-command", `Command "${top.label}" run ${top.occurrences} times`, [
              metric("occurrences", top.occurrences, "exact"),
              metric("sessions", top.sessions, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Combine repeated invocations into one step, or script the loop instead of re-running the command by hand.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-003 Repeated unchanged failure. */
export function tools003(): RecommendationRule {
  return {
    id: "TOOLS-003",
    version: 1,
    category: "tools",
    defaultThresholds: { minOccurrences: 2 },
    async evaluate(ctx) {
      const rows = ctx.snapshot.tools.repeatedFailedCommands;
      if (rows.length === 0) return [];
      const min = threshold(ctx, "minOccurrences", 2);
      const top = rows[0];
      if (!top || top.occurrences < min) return [];
      const confidence = confidenceForCount(top.occurrences, 0.6, 0.1, 0.9);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-003",
          ruleVersion: 1,
          category: "tools",
          severity: "high",
          confidence,
          title: "Repeated unchanged failure",
          summary: `Command "${top.label}" failed ${top.occurrences}× without a change in strategy`,
          explanation: `Materially identical commands failed repeatedly without a meaningful change in arguments or approach. Re-running an unchanged failing command wastes turns and signals a missing diagnosis step.`,
          evidence: [
            evidence(
              "repeated-failed-command",
              `Command "${top.label}" failed ${top.occurrences} times`,
              [
                metric("occurrences", top.occurrences, "exact"),
                metric("sessions", top.sessions, "exact"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "After a failure, change the approach — read the error, inspect the failing file, or run a narrower diagnostic — before retrying the same command.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-004 Excessive broad test runs. */
export function tools004(): RecommendationRule {
  return {
    id: "TOOLS-004",
    version: 1,
    category: "tools",
    defaultThresholds: { minBroadRuns: 3, maxFilesChanged: 2 },
    async evaluate(ctx) {
      const broad = num(ctx.snapshot.tools.broadTestRunCount) ?? 0;
      const min = threshold(ctx, "minBroadRuns", 3);
      if (broad < min) return [];
      const filesChanged = num(ctx.snapshot.workflow.filesChangedPerSession) ?? 0;
      const maxFiles = threshold(ctx, "maxFilesChanged", 2);
      // Conservative confidence (spec): broad runs may be justified.
      const overThreshold = Math.max(0, broad - min);
      const confidence = Math.min(0.55, 0.35 + overThreshold * 0.05);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-004",
          ruleVersion: 1,
          category: "tools",
          severity: "low",
          confidence,
          title: "Excessive broad test runs",
          summary: `${broad} broad test runs in this window (avg ${filesChanged.toFixed(1)} files changed/session)`,
          explanation: `A broad/full test suite was run repeatedly while changes were limited to a narrow area. A narrower test command is likely available and would be faster.`,
          evidence: [
            evidence("broad-test-runs", `${broad} broad-scope test runs`, [
              metric("broadTestRuns", broad, "exact"),
              metric("filesChangedPerSession", Number(filesChanged.toFixed(2)), "inferred"),
              metric("narrowerCommandAvailable", filesChanged <= maxFiles ? 1 : 0, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "After a narrow change, run the specific affected test file/path rather than the full suite.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-005 Oversized tool result. */
export function tools005(): RecommendationRule {
  return {
    id: "TOOLS-005",
    version: 1,
    category: "tools",
    defaultThresholds: { minOutputBytes: 200_000 },
    async evaluate(ctx) {
      const largest = num(ctx.snapshot.tools.largestToolOutputsBytes);
      const min = threshold(ctx, "minOutputBytes", 200_000);
      if (largest == null || largest < min) return [];
      const over = largest / min;
      const confidence = Math.min(0.85, 0.5 + Math.min(1, over - 1) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-005",
          ruleVersion: 1,
          category: "tools",
          severity: "medium",
          confidence,
          title: "Oversized tool result",
          summary: `Largest tool output was ${(largest / 1024).toFixed(0)} KiB`,
          explanation: `A command or tool produced unusually large output that likely contributed unnecessary context. Large outputs inflate token usage and may obscure the relevant result.`,
          evidence: [
            evidence("oversized-output", `${largest} byte largest tool output`, [
              metric("largestOutputBytes", largest, "reported"),
              metric("thresholdBytes", min, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Pipe large command output through head/grep/jq, or write it to a file and read only the summary.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-006 High exploration-to-change ratio. */
export function tools006(): RecommendationRule {
  return {
    id: "TOOLS-006",
    version: 1,
    category: "tools",
    defaultThresholds: { minReads: 8, maxFilesChanged: 2 },
    async evaluate(ctx) {
      // Use read/write ratio + files changed per session as the exploration signal.
      const ratio = num(ctx.snapshot.workflow.readToWriteRatio);
      const filesChanged = num(ctx.snapshot.workflow.filesChangedPerSession) ?? 0;
      const minReads = threshold(ctx, "minReads", 8);
      const maxFiles = threshold(ctx, "maxFilesChanged", 2);
      if (ratio == null || ratio < minReads) return [];
      if (filesChanged > maxFiles) return [];
      // Moderate confidence (spec): exploration is not always wasteful.
      const confidence = Math.min(0.6, 0.4 + Math.min(1, (ratio - minReads) / minReads) * 0.2);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-006",
          ruleVersion: 1,
          category: "tools",
          severity: "low",
          confidence,
          title: "High exploration-to-change ratio",
          summary: `Read/write ratio ${ratio.toFixed(1)}× with ~${filesChanged.toFixed(1)} files changed/session`,
          explanation: `The session read or searched many files but changed very few. Some exploration is legitimate, so this is moderate confidence — review whether the exploration was necessary or could be delegated/narrowed.`,
          evidence: [
            evidence(
              "exploration-to-change",
              `${ratio.toFixed(1)} reads per write, ${filesChanged.toFixed(1)} files changed/session`,
              [
                metric("readToWriteRatio", Number(ratio.toFixed(2)), "exact"),
                metric("filesChangedPerSession", Number(filesChanged.toFixed(2)), "inferred"),
                metric("minReadsThreshold", minReads, "heuristic"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Narrow exploration with targeted search, or delegate broad sweeps to a subagent so the main context stays focused.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-007 Repeated unchanged searches (§15.4 duplicate searches). */
export function tools007(): RecommendationRule {
  return {
    id: "TOOLS-007",
    version: 1,
    category: "tools",
    defaultThresholds: { minOccurrences: 3 },
    async evaluate(ctx) {
      const rows = ctx.snapshot.tools.repeatedSearches;
      if (rows.length === 0) return [];
      const min = threshold(ctx, "minOccurrences", 3);
      const top = rows[0];
      if (!top || top.occurrences < min) return [];
      const confidence = confidenceForCount(top.occurrences, 0.45, 0.07, 0.8);
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-007",
          ruleVersion: 1,
          category: "tools",
          severity: "low",
          confidence,
          title: "Repeated unchanged searches",
          summary: `Search "${top.label}" run ${top.occurrences}× across ${top.sessions} session(s)`,
          explanation: `The same search (tool + input) recurred without a change in query. Re-searching suggests the result was not retained or the query was not narrowed. Repeating an identical search rarely yields new information.`,
          evidence: [
            evidence("repeated-search", `Search "${top.label}" run ${top.occurrences} times`, [
              metric("occurrences", top.occurrences, "exact"),
              metric("sessions", top.sessions, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Run a search once and keep its result, or refine the query instead of re-running the identical search.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** TOOLS-008 Repeatedly failing tool (§15.4 unused or failing MCP tools). */
export function tools008(): RecommendationRule {
  return {
    id: "TOOLS-008",
    version: 1,
    category: "tools",
    defaultThresholds: { minFailureRate: 0.5, minFailures: 2 },
    async evaluate(ctx) {
      const tools = ctx.snapshot.tools.mostUsedTools;
      if (tools.length === 0) return [];
      const minRate = threshold(ctx, "minFailureRate", 0.5);
      const minFailures = threshold(ctx, "minFailures", 2);
      // Pick the tool with the most failures that still exceeds the rate floor.
      let worst: { toolName: string; calls: number; failures: number; failureRate: number } | null =
        null;
      for (const t of tools) {
        if (t.failureRate < minRate) continue;
        if (t.failures < minFailures) continue;
        if (!worst || t.failures > worst.failures) {
          worst = {
            toolName: t.toolName,
            calls: t.calls,
            failures: t.failures,
            failureRate: t.failureRate,
          };
        }
      }
      if (!worst) return [];
      const confidence = Math.min(
        0.8,
        0.4 + Math.min(1, worst.failures / (minFailures * 2)) * 0.35,
      );
      return [
        candidate({
          ctx,
          ruleId: "TOOLS-008",
          ruleVersion: 1,
          category: "tools",
          severity: "medium",
          confidence,
          title: "Repeatedly failing tool",
          summary: `Tool "${worst.toolName}" failed ${worst.failures}/${worst.calls}× (${(worst.failureRate * 100).toFixed(0)}% failure rate)`,
          explanation: `A tool — often an MCP server — failed a large share of the times it was called. Repeated MCP failures usually indicate a misconfigured or unavailable server, or a tool that is not appropriate for the task. Continuing to call it wastes turns.`,
          evidence: [
            evidence("failing-tool", `Tool "${worst.toolName}" with high failure rate`, [
              metric("toolName", worst.toolName, "exact"),
              metric("calls", worst.calls, "exact"),
              metric("failures", worst.failures, "exact"),
              metric("failureRate", Number(worst.failureRate.toFixed(2)), "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Check the failing tool/MCP server configuration and availability, or stop invoking it for tasks it does not support.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
