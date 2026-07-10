/**
 * WORKFLOW-001..002 deterministic rules (spec §13.10).
 *
 * Phase 1 uses only deterministic phrases and structural indicators (per spec);
 * semantic improvement lands in Phase 3.
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

/** Corrective-turn indicator phrases (deterministic, Phase 1). */
const CORRECTIVE_PHRASES = [
  "no, ",
  "not ",
  "wait",
  "actually",
  "instead",
  "i meant",
  "i meant to",
  "undo",
  "revert",
  "don't",
  "stop",
  "wrong",
  "that's not",
  "that isnt",
];

/** WORKFLOW-001 Excessive corrective turns. */
export function workflow001(): RecommendationRule {
  return {
    id: "WORKFLOW-001",
    version: 1,
    category: "workflow",
    defaultThresholds: { minCorrective: 3 },
    async evaluate(ctx) {
      const count = num(ctx.snapshot.workflow.correctivePromptCount) ?? 0;
      const min = threshold(ctx, "minCorrective", 3);
      if (count < min) return [];
      const confidence = confidenceForCount(count, 0.5, 0.08, 0.8);
      return [
        candidate({
          ctx,
          ruleId: "WORKFLOW-001",
          ruleVersion: 1,
          category: "workflow",
          severity: "medium",
          confidence,
          title: "Excessive corrective turns",
          summary: `${count} corrective prompt(s) detected after failed verification`,
          explanation: `Multiple prompts appear to correct or reverse prior work (prompt following a failed verification). This signals an unclear objective or missing acceptance criteria up front.`,
          evidence: [
            evidence("corrective-turns", `${count} corrective prompts`, [
              metric("correctivePromptCount", count, "inferred"),
              metric("indicatorPhrases", CORRECTIVE_PHRASES.length, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "State the objective, scope and acceptance criteria in the first prompt so fewer corrective turns are needed.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** WORKFLOW-002 Very long session with task switching (conservative, Phase 1). */
export function workflow002(): RecommendationRule {
  return {
    id: "WORKFLOW-002",
    version: 1,
    category: "workflow",
    defaultThresholds: { minDurationMs: 3_600_000, minPromptsPerSession: 6 },
    async evaluate(ctx) {
      const medianDuration = num(ctx.snapshot.usage.medianSessionDurationMs);
      const prompts = num(ctx.snapshot.usage.promptsPerSession) ?? 0;
      const minDur = threshold(ctx, "minDurationMs", 3_600_000);
      const minPrompts = threshold(ctx, "minPromptsPerSession", 6);
      if (medianDuration == null || medianDuration < minDur) return [];
      if (prompts < minPrompts) return [];
      // Conservative (spec): deterministic structural indicators only in Phase 1.
      const confidence = 0.45;
      return [
        candidate({
          ctx,
          ruleId: "WORKFLOW-002",
          ruleVersion: 1,
          category: "workflow",
          severity: "low",
          confidence,
          title: "Very long session with task switching",
          summary: `Median session ${(medianDuration / 60_000).toFixed(0)} min with ~${prompts.toFixed(1)} prompts/session`,
          explanation: `Long sessions with many prompts may mix unrelated tasks. This is a conservative structural indicator — semantic task-switching detection improves in Phase 3.`,
          evidence: [
            evidence(
              "long-session",
              `median ${medianDuration} ms, ${prompts.toFixed(2)} prompts/session`,
              [
                metric("medianSessionDurationMs", medianDuration, "inferred"),
                metric("promptsPerSession", Number(prompts.toFixed(2)), "inferred"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "Split long multi-task sessions into focused sessions, one objective each, to keep context relevant.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
