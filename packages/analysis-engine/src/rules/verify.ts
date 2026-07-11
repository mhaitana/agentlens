/**
 * VERIFY-001..006 deterministic rules (spec §13.10, §15.4 verification quality).
 *
 * Verification-quality rules read the workflow/tool metrics from the snapshot
 * and emit at most one candidate each. Conservative where the spec demands.
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

/** VERIFY-001 No verification after code changes. */
export function verify001(): RecommendationRule {
  return {
    id: "VERIFY-001",
    version: 1,
    category: "verification",
    defaultThresholds: { minSessions: 1 },
    async evaluate(ctx) {
      const count = num(ctx.snapshot.workflow.sessionsWithChangesButNoVerification) ?? 0;
      const min = threshold(ctx, "minSessions", 1);
      if (count < min) return [];
      const total = ctx.snapshot.usage.totalSessions.value as number;
      const ratio = total > 0 ? count / total : 0;
      const confidence = Math.min(0.9, 0.55 + ratio * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-001",
          ruleVersion: 1,
          category: "verification",
          severity: "high",
          confidence,
          title: "No verification after code changes",
          summary: `${count} session(s) changed code but ran no recognised verification command`,
          explanation: `Code was modified in these sessions without a following test, build, lint or typecheck. Unverified changes risk regressions that surface later.`,
          evidence: [
            evidence(
              "changes-without-verification",
              `${count} sessions with writes and no verification`,
              [metric("sessions", count, "inferred"), metric("totalSessions", total, "exact")],
            ),
          ],
          remediation: instructionRemediation(
            "After making code changes, run a verification command (test/typecheck/lint/build) before ending the task.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** VERIFY-002 Changes after final successful verification. */
export function verify002(): RecommendationRule {
  return {
    id: "VERIFY-002",
    version: 1,
    category: "verification",
    defaultThresholds: { minSessions: 1 },
    async evaluate(ctx) {
      const count = num(ctx.snapshot.workflow.changesAfterFinalVerification) ?? 0;
      const min = threshold(ctx, "minSessions", 1);
      if (count < min) return [];
      const confidence = confidenceForCount(count, 0.55, 0.1, 0.9);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-002",
          ruleVersion: 1,
          category: "verification",
          severity: "medium",
          confidence,
          title: "Changes after final successful verification",
          summary: `${count} session(s) had file changes after the last verification run`,
          explanation: `Files changed after the last successful test/build/lint/typecheck, so the final verification did not cover the latest changes.`,
          evidence: [
            evidence(
              "changes-after-verification",
              `${count} sessions with writes after final verification`,
              [metric("sessions", count, "inferred")],
            ),
          ],
          remediation: instructionRemediation(
            "Re-run verification after the last edit, not before, so the final state is covered.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** VERIFY-003 Session ended with failed verification. */
export function verify003(): RecommendationRule {
  return {
    id: "VERIFY-003",
    version: 1,
    category: "verification",
    defaultThresholds: { minSessions: 1 },
    async evaluate(ctx) {
      const count = num(ctx.snapshot.workflow.sessionsEndingWithKnownFailures) ?? 0;
      const min = threshold(ctx, "minSessions", 1);
      if (count < min) return [];
      const confidence = confidenceForCount(count, 0.6, 0.1, 0.9);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-003",
          ruleVersion: 1,
          category: "verification",
          severity: "high",
          confidence,
          title: "Session ended with failed verification",
          summary: `${count} session(s) ended with a known-failed verification and no later success`,
          explanation: `The latest relevant verification command failed and was never followed by a success, so the session likely ended in an unverified state.`,
          evidence: [
            evidence("failed-verification-at-end", `${count} sessions ending with known failures`, [
              metric("sessions", count, "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "Resolve the failing verification (or explicitly acknowledge the failure) before ending the session.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** VERIFY-004 Narrow verification only (conservative). */
export function verify004(): RecommendationRule {
  return {
    id: "VERIFY-004",
    version: 1,
    category: "verification",
    defaultThresholds: { minSessions: 1 },
    async evaluate(ctx) {
      const count = num(ctx.snapshot.workflow.narrowVerificationOnlySessions) ?? 0;
      const min = threshold(ctx, "minSessions", 1);
      if (count < min) return [];
      // Conservative confidence (spec): the "narrowness" is a heuristic.
      const confidence = Math.min(0.55, 0.35 + count * 0.05);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-004",
          ruleVersion: 1,
          category: "verification",
          severity: "low",
          confidence,
          title: "Narrow verification only",
          summary: `${count} session(s) with cross-cutting changes received only one verification kind`,
          explanation: `A substantial cross-cutting change (≥3 distinct files) was followed by only a single, narrow verification step (e.g. unit tests but no typecheck/lint). Broader verification would catch more regressions.`,
          evidence: [
            evidence(
              "narrow-verification",
              `${count} sessions with cross-cutting writes but one verification kind`,
              [
                metric("sessions", count, "inferred"),
                metric("distinctPathThreshold", 3, "heuristic"),
              ],
            ),
          ],
          remediation: instructionRemediation(
            "For cross-cutting changes, run a complementary verification step (e.g. add a typecheck or lint alongside tests).",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** VERIFY-005 No test runs despite code changes (§15.4 "no tests"). */
export function verify005(): RecommendationRule {
  return {
    id: "VERIFY-005",
    version: 1,
    category: "verification",
    defaultThresholds: { minSessions: 1 },
    async evaluate(ctx) {
      const testRuns = num(ctx.snapshot.tools.testCommandFrequency) ?? 0;
      if (testRuns > 0) return [];
      const noVerify = num(ctx.snapshot.workflow.sessionsWithChangesButNoVerification) ?? 0;
      const totalSessions = ctx.snapshot.usage.totalSessions.value as number;
      const min = threshold(ctx, "minSessions", 1);
      // Only meaningful when there were sessions that changed code.
      if (noVerify < min) return [];
      const share = totalSessions > 0 ? noVerify / totalSessions : 0;
      const confidence = Math.min(0.85, 0.5 + share * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-005",
          ruleVersion: 1,
          category: "verification",
          severity: "high",
          confidence,
          title: "No test runs despite code changes",
          summary: `0 test runs in the window; ${noVerify} session(s) changed code without verification`,
          explanation: `No recognised test command ran in the window while code was being changed. Tests are the most direct verification of behaviour; their complete absence means changes are landing without any behavioural check.`,
          evidence: [
            evidence("no-tests-with-changes", "No test runs while code changed", [
              metric("testCommandFrequency", testRuns, "exact"),
              metric("sessionsWithChangesButNoVerification", noVerify, "inferred"),
              metric("totalSessions", totalSessions, "exact"),
            ]),
          ],
          remediation: instructionRemediation(
            "Run the project's test command after code changes; if no tests exist for the changed area, add at least one.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** VERIFY-006 No build verification despite changes (§15.4 "no build"). */
export function verify006(): RecommendationRule {
  return {
    id: "VERIFY-006",
    version: 1,
    category: "verification",
    defaultThresholds: { minFilesPerSession: 3 },
    async evaluate(ctx) {
      const buildRuns = num(ctx.snapshot.tools.buildCommandFrequency) ?? 0;
      if (buildRuns > 0) return [];
      const filesPerSession = num(ctx.snapshot.workflow.filesChangedPerSession) ?? 0;
      const noVerify = num(ctx.snapshot.workflow.sessionsWithChangesButNoVerification) ?? 0;
      const minFiles = threshold(ctx, "minFilesPerSession", 3);
      // Only meaningful for substantial change sets; conservative otherwise.
      if (filesPerSession < minFiles) return [];
      if (noVerify < 1) return [];
      const confidence = Math.min(0.6, 0.35 + Math.min(1, filesPerSession / 8) * 0.2);
      return [
        candidate({
          ctx,
          ruleId: "VERIFY-006",
          ruleVersion: 1,
          category: "verification",
          severity: "medium",
          confidence,
          title: "No build verification despite changes",
          summary: `0 build runs; ~${filesPerSession.toFixed(1)} files changed/session`,
          explanation: `No recognised build command ran while substantial changes were being made. For projects with a build step, skipping it means type or compile errors can land unobserved. This is conservative — not every project has a build step.`,
          evidence: [
            evidence("no-build-with-changes", "No build runs while substantial changes made", [
              metric("buildCommandFrequency", buildRuns, "exact"),
              metric("filesChangedPerSession", Number(filesPerSession.toFixed(2)), "inferred"),
              metric("sessionsWithChangesButNoVerification", noVerify, "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "If the project has a build/compile step, run it after substantial changes (or add a typecheck as a lighter alternative).",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
