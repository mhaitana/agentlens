/**
 * VERIFY-001..004 deterministic rules (spec §13.10).
 *
 * Verification-quality rules read the workflow metrics from the snapshot and
 * emit at most one candidate each. Conservative where the spec demands.
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
