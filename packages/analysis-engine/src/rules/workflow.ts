/**
 * WORKFLOW-001..004 deterministic rules (spec §13.10, §15.4 workflow quality).
 *
 * Phase 1 used deterministic phrases and structural indicators; Phase 3 (§15.4)
 * adds large-change-without-verification and repeated-manual-validation rules.
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

/** WORKFLOW-003 Large changes without a planning/verification indicator (§15.4). */
export function workflow003(): RecommendationRule {
  return {
    id: "WORKFLOW-003",
    version: 1,
    category: "workflow",
    defaultThresholds: { minFilesPerSession: 5, minSessions: 2 },
    async evaluate(ctx) {
      const filesPerSession = num(ctx.snapshot.workflow.filesChangedPerSession) ?? 0;
      const noVerify = num(ctx.snapshot.workflow.sessionsWithChangesButNoVerification) ?? 0;
      const totalSessions = ctx.snapshot.usage.totalSessions.value as number;
      const minFiles = threshold(ctx, "minFilesPerSession", 5);
      const minSessions = threshold(ctx, "minSessions", 2);
      if (filesPerSession < minFiles) return [];
      if (noVerify < minSessions) return [];
      const share = totalSessions > 0 ? noVerify / totalSessions : 0;
      const confidence = Math.min(
        0.7,
        0.35 + Math.min(1, share) * 0.3 + Math.min(1, filesPerSession / 10) * 0.1,
      );
      return [
        candidate({
          ctx,
          ruleId: "WORKFLOW-003",
          ruleVersion: 1,
          category: "workflow",
          severity: "medium",
          confidence,
          title: "Large changes without verification",
          summary: `~${filesPerSession.toFixed(1)} files changed/session; ${noVerify} session(s) had no verification`,
          explanation: `The window shows large per-session change sets and several sessions that changed code without a recognised verification run. Large changesets without verification (or a stated plan) are the riskiest workflow pattern: regressions surface later and are hard to attribute. Pair large changes with a plan and a verification step.`,
          evidence: [
            evidence("large-changes-no-verification", "Large changesets without verification", [
              metric("filesChangedPerSession", Number(filesPerSession.toFixed(2)), "inferred"),
              metric("sessionsWithChangesButNoVerification", noVerify, "inferred"),
              metric("totalSessions", totalSessions, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "For large changesets, state a plan up front and run a verification command (test/typecheck/lint/build) before ending the session.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** WORKFLOW-004 Repeated manual validation suitable for a hook (§15.4). */
export function workflow004(): RecommendationRule {
  return {
    id: "WORKFLOW-004",
    version: 1,
    category: "workflow",
    defaultThresholds: { minRuns: 8, minSessions: 3 },
    async evaluate(ctx) {
      const testRuns = num(ctx.snapshot.tools.testCommandFrequency) ?? 0;
      const buildRuns = num(ctx.snapshot.tools.buildCommandFrequency) ?? 0;
      const total = testRuns + buildRuns;
      const totalSessions = ctx.snapshot.usage.totalSessions.value as number;
      const minRuns = threshold(ctx, "minRuns", 8);
      const minSessions = threshold(ctx, "minSessions", 3);
      if (total < minRuns) return [];
      if (totalSessions < minSessions) return [];
      const confidence = Math.min(0.65, 0.35 + Math.min(1, total / (minRuns * 2)) * 0.3);
      const dominant = testRuns >= buildRuns ? "test" : "build";
      return [
        candidate({
          ctx,
          ruleId: "WORKFLOW-004",
          ruleVersion: 1,
          category: "workflow",
          severity: "low",
          confidence,
          title: "Repeated manual validation suitable for a hook",
          summary: `${total} verification runs (${testRuns} test, ${buildRuns} build) across ${totalSessions} session(s)`,
          explanation: `Deterministic verification commands (tests/builds) were run very frequently by hand. When the same validation is run repeatedly, a Claude Code hook can run it automatically after edits — removing the manual step and guaranteeing it is never skipped.`,
          evidence: [
            evidence("repeated-manual-validation", "Frequent hand-run verification commands", [
              metric("testCommandFrequency", testRuns, "exact"),
              metric("buildCommandFrequency", buildRuns, "exact"),
              metric("totalVerificationRuns", total, "exact"),
              metric("totalSessions", totalSessions, "exact"),
              metric("dominantKind", dominant, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Consider a Claude Code PostToolUse hook that runs the dominant verification command automatically after edits (AgentLens `doctor` can draft this).",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
