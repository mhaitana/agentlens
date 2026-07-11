/**
 * PROMPT-001..005 deterministic rules (spec §15.4 prompt effectiveness).
 *
 * These rules read the snapshot's prompt-effectiveness aggregates (§15.4
 * {@link PromptMetrics}), which are derived from per-prompt structural features
 * extracted deterministically at import time (§15.5). Each rule emits at most
 * one candidate. Prompt length is never equated with prompt quality (§15.4):
 * every rule is keyed on structural signals, not on character count.
 */
import type { RecommendationRule } from "@agentlens/domain";
import { candidate, evidence, instructionRemediation, metric, num, threshold } from "./helpers.js";

/** PROMPT-001 Missing acceptance criteria on substantive work. */
export function prompt001(): RecommendationRule {
  return {
    id: "PROMPT-001",
    version: 1,
    category: "prompt",
    defaultThresholds: { minPrompts: 4, maxCriteriaShare: 0.2 },
    async evaluate(ctx) {
      const total = num(ctx.snapshot.prompt.totalPrompts) ?? 0;
      const withCriteria = num(ctx.snapshot.prompt.referencesAcceptanceCriteriaCount) ?? 0;
      const minPrompts = threshold(ctx, "minPrompts", 4);
      const maxShare = threshold(ctx, "maxCriteriaShare", 0.2);
      if (total < minPrompts) return [];
      const share = total > 0 ? withCriteria / total : 0;
      if (share > maxShare) return [];
      const missing = total - withCriteria;
      const confidence = Math.min(0.7, 0.35 + Math.min(1, missing / minPrompts) * 0.35);
      return [
        candidate({
          ctx,
          ruleId: "PROMPT-001",
          ruleVersion: 1,
          category: "prompt",
          severity: "medium",
          confidence,
          title: "Prompts rarely state acceptance criteria",
          summary: `${missing} of ${total} prompt(s) referenced no acceptance criteria`,
          explanation: `Most prompts did not state what "done" looks like. Without acceptance criteria the agent guesses at completion, which often leads to extra corrective turns. Stating a concrete, checkable criterion (e.g. "tests pass for X") is the highest-leverage prompt improvement.`,
          evidence: [
            evidence("missing-acceptance-criteria", "Few prompts reference acceptance criteria", [
              metric("totalPrompts", total, "exact"),
              metric("promptsReferencingAcceptanceCriteria", withCriteria, "heuristic"),
              metric("missingCriteriaPrompts", missing, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Add a one-line acceptance criterion to task prompts (e.g. 'done when the X tests pass').",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** PROMPT-002 Missing verification request. */
export function prompt002(): RecommendationRule {
  return {
    id: "PROMPT-002",
    version: 1,
    category: "prompt",
    defaultThresholds: { minPrompts: 4, maxVerifyShare: 0.2 },
    async evaluate(ctx) {
      const total = num(ctx.snapshot.prompt.totalPrompts) ?? 0;
      const withVerify = num(ctx.snapshot.prompt.requestsVerificationCount) ?? 0;
      const minPrompts = threshold(ctx, "minPrompts", 4);
      const maxShare = threshold(ctx, "maxVerifyShare", 0.2);
      if (total < minPrompts) return [];
      const share = total > 0 ? withVerify / total : 0;
      if (share > maxShare) return [];
      const missing = total - withVerify;
      const confidence = Math.min(0.65, 0.3 + Math.min(1, missing / minPrompts) * 0.35);
      return [
        candidate({
          ctx,
          ruleId: "PROMPT-002",
          ruleVersion: 1,
          category: "prompt",
          severity: "low",
          confidence,
          title: "Prompts rarely request verification",
          summary: `${missing} of ${total} prompt(s) did not ask for verification`,
          explanation: `Few prompts asked the agent to verify its work. Pairing an implementation request with an explicit verification request ("then run the tests") makes the verification step a first-class part of the task rather than an omission.`,
          evidence: [
            evidence("missing-verification-request", "Few prompts request verification", [
              metric("totalPrompts", total, "exact"),
              metric("promptsRequestingVerification", withVerify, "heuristic"),
              metric("missingVerificationPrompts", missing, "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Append an explicit verification request to implementation prompts (e.g. 'then run lint and the tests').",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** PROMPT-003 Multiple independent tasks in one prompt. */
export function prompt003(): RecommendationRule {
  return {
    id: "PROMPT-003",
    version: 1,
    category: "prompt",
    defaultThresholds: { minMultiTask: 3, minShare: 0.3 },
    async evaluate(ctx) {
      const total = num(ctx.snapshot.prompt.totalPrompts) ?? 0;
      const multi = num(ctx.snapshot.prompt.multipleIndependentTasksCount) ?? 0;
      const minMulti = threshold(ctx, "minMultiTask", 3);
      const minShare = threshold(ctx, "minShare", 0.3);
      if (multi < minMulti) return [];
      const share = total > 0 ? multi / total : 0;
      if (share < minShare) return [];
      const confidence = Math.min(0.65, 0.35 + Math.min(1, multi / minMulti) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "PROMPT-003",
          ruleVersion: 1,
          category: "prompt",
          severity: "medium",
          confidence,
          title: "Multiple independent tasks per prompt",
          summary: `${multi} prompt(s) bundled several independent tasks`,
          explanation: `Several prompts each contained multiple independent tasks. Bundling tasks makes progress harder to verify and a single failure harder to attribute. Splitting into one objective per prompt improves traceability and verification.`,
          evidence: [
            evidence("multi-task-prompts", "Prompts bundle multiple independent tasks", [
              metric("totalPrompts", total, "exact"),
              metric("multiTaskPrompts", multi, "heuristic"),
              metric("multiTaskShare", Number(share.toFixed(2)), "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Split bundled objectives into one task per prompt so each can be verified independently.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** PROMPT-004 Vague references ("fix this", "the issue") without a clear target. */
export function prompt004(): RecommendationRule {
  return {
    id: "PROMPT-004",
    version: 1,
    category: "prompt",
    defaultThresholds: { minVague: 4, minPerPrompt: 0.5 },
    async evaluate(ctx) {
      const total = num(ctx.snapshot.prompt.totalPrompts) ?? 0;
      const vague = num(ctx.snapshot.prompt.vagueReferenceCount) ?? 0;
      const minVague = threshold(ctx, "minVague", 4);
      const minPerPrompt = threshold(ctx, "minPerPrompt", 0.5);
      if (vague < minVague || total === 0) return [];
      const perPrompt = vague / total;
      if (perPrompt < minPerPrompt) return [];
      const confidence = Math.min(0.6, 0.3 + Math.min(1, vague / minVague) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "PROMPT-004",
          ruleVersion: 1,
          category: "prompt",
          severity: "low",
          confidence,
          title: "Vague references in prompts",
          summary: `${vague} vague reference(s) across ${total} prompt(s)`,
          explanation: `Prompts frequently used open references like "this", "the issue", or "fix that" without naming the target. Naming the concrete file, symbol, or behaviour removes a round-trip of clarification.`,
          evidence: [
            evidence("vague-references", "Prompts use open references", [
              metric("totalPrompts", total, "exact"),
              metric("vagueReferenceCount", vague, "heuristic"),
              metric("vaguePerPrompt", Number(perPrompt.toFixed(2)), "heuristic"),
            ]),
          ],
          remediation: instructionRemediation(
            "Replace open references with the concrete target (file path, symbol name, or observed behaviour).",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}

/** PROMPT-005 Repeated user corrections (uses corrective-prompt aggregate). */
export function prompt005(): RecommendationRule {
  return {
    id: "PROMPT-005",
    version: 1,
    category: "prompt",
    defaultThresholds: { minCorrective: 3, minShare: 0.2 },
    async evaluate(ctx) {
      const total = num(ctx.snapshot.prompt.totalPrompts) ?? 0;
      const corrective = num(ctx.snapshot.workflow.correctivePromptCount) ?? 0;
      const minCorrective = threshold(ctx, "minCorrective", 3);
      const minShare = threshold(ctx, "minShare", 0.2);
      if (corrective < minCorrective || total === 0) return [];
      const share = corrective / total;
      if (share < minShare) return [];
      const confidence = Math.min(0.7, 0.4 + Math.min(1, corrective / minCorrective) * 0.3);
      return [
        candidate({
          ctx,
          ruleId: "PROMPT-005",
          ruleVersion: 1,
          category: "prompt",
          severity: "medium",
          confidence,
          title: "Repeated user corrections",
          summary: `${corrective} corrective prompt(s) out of ${total}`,
          explanation: `A meaningful share of prompts corrected or reversed prior work. Frequent corrections usually mean the initial prompt under-specified the objective or acceptance criteria. Front-loading scope and criteria tends to reduce these round-trips.`,
          evidence: [
            evidence("repeated-corrections", "Many prompts correct prior work", [
              metric("totalPrompts", total, "exact"),
              metric("correctivePromptCount", corrective, "inferred"),
              metric("correctiveShare", Number(share.toFixed(2)), "inferred"),
            ]),
          ],
          remediation: instructionRemediation(
            "State the objective, scope and acceptance criteria up front to reduce corrective round-trips.",
          ),
        }),
      ];
    },
    explain(c) {
      return c.summary;
    },
  };
}
