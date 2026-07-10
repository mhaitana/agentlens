/**
 * CONTEXT-001..002 deterministic rules (spec §13.10).
 *
 * Context-efficiency rules read the usage/tool metrics from the snapshot and
 * emit at most one candidate each.
 */
import type { RecommendationRule } from "@agentlens/domain";
import { candidate, evidence, instructionRemediation, metric, num, threshold } from "./helpers.js";

/** CONTEXT-001 Frequent compaction. */
export function context001(): RecommendationRule {
  return {
    id: "CONTEXT-001",
    version: 1,
    category: "context",
    defaultThresholds: { minCompactions: 2, minPreCompactionTokens: 100_000 },
    async evaluate(ctx) {
      const totalCompactions = num(ctx.snapshot.usage.totalCompactions) ?? 0;
      const min = threshold(ctx, "minCompactions", 2);
      if (totalCompactions < min) return [];
      // Sessions with repeated compactions or unusually high pre-compaction context.
      const sessions = ctx.snapshot.usage.totalSessions.value as number;
      const compactionsPerSession = sessions > 0 ? totalCompactions / sessions : 0;
      const confidence = Math.min(0.8, 0.45 + Math.min(1, compactionsPerSession) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-001",
          ruleVersion: 1,
          category: "context",
          severity: "medium",
          confidence,
          title: "Frequent compaction",
          summary: `${totalCompactions} compaction(s) across ${sessions} session(s)`,
          explanation: `Repeated compactions indicate the context grew large enough to be summarised. Each compaction can drop detail and costs tokens. Reducing always-on context or large repeated outputs helps.`,
          evidence: [
            evidence("frequent-compaction", `${totalCompactions} compactions`, [
              metric("totalCompactions", totalCompactions, "exact"),
              metric("sessions", sessions, "exact"),
              metric("compactionsPerSession", Number(compactionsPerSession.toFixed(2)), "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "Trim always-on context (skills/plugins/large files) and avoid repeatedly re-reading large outputs.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** CONTEXT-002 Large repeated outputs. */
export function context002(): RecommendationRule {
  return {
    id: "CONTEXT-002",
    version: 1,
    category: "context",
    defaultThresholds: { minOutputBytes: 100_000, minRepeatedCommands: 1 },
    async evaluate(ctx) {
      const largest = num(ctx.snapshot.tools.largestToolOutputsBytes);
      const repeated = ctx.snapshot.tools.repeatedCommands;
      const minBytes = threshold(ctx, "minOutputBytes", 100_000);
      const minRepeated = threshold(ctx, "minRepeatedCommands", 1);
      if (largest == null || largest < minBytes) return [];
      if (repeated.length < minRepeated) return [];
      const confidence = Math.min(0.75, 0.45 + Math.min(1, largest / (minBytes * 4)) * 0.25);
      return [
        candidate({
          ctx,
          ruleId: "CONTEXT-002",
          ruleVersion: 1,
          category: "context",
          severity: "medium",
          confidence,
          title: "Large repeated outputs",
          summary: `Largest output ${(largest / 1024).toFixed(0)} KiB with ${repeated.length} repeated command pattern(s)`,
          explanation: `Large command outputs repeatedly entered the session context. Combined with repeated commands, this inflates context and can trigger compaction.`,
          evidence: [
            evidence(
              "large-repeated-output",
              `${largest} byte largest output, ${repeated.length} repeated command groups`,
              [
                metric("largestOutputBytes", largest, "reported"),
                metric("repeatedCommandGroups", repeated.length, "exact"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Summarise or page large outputs, write them to a file, or pipe through a filter before they enter context.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
