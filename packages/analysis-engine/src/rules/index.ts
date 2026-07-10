/**
 * Default deterministic recommendation rule set (spec §13.10).
 *
 * 16 rules across five categories: TOOLS-001..006, VERIFY-001..004,
 * WORKFLOW-001..002, CONTEXT-001..002, SECURITY-001..002. Each carries a stable
 * id + version, configurable thresholds, deterministic confidence, an evidence
 * builder, an explanation, and a remediation. Tests live in `rules.test.ts`;
 * documentation lives in `docs/rules.md`.
 */
import type { RecommendationRule } from "@agentlens/domain";
import { tools001, tools002, tools003, tools004, tools005, tools006 } from "./tools.js";
import { verify001, verify002, verify003, verify004 } from "./verify.js";
import { workflow001, workflow002 } from "./workflow.js";
import { context001, context002 } from "./context.js";
import { security001, security002 } from "./security.js";

/** All 16 Phase 1 deterministic rules in spec order. */
export function defaultRules(): RecommendationRule[] {
  return [
    tools001(),
    tools002(),
    tools003(),
    tools004(),
    tools005(),
    tools006(),
    verify001(),
    verify002(),
    verify003(),
    verify004(),
    workflow001(),
    workflow002(),
    context001(),
    context002(),
    security001(),
    security002(),
  ];
}

/** Human-readable description of each rule (for `agentlens rules list/explain`). */
export interface RuleMetadata {
  id: string;
  version: number;
  category: string;
  severity: string;
  title: string;
  description: string;
  defaultThresholds: Record<string, number | string | boolean>;
}

/** Metadata for the default rule set (used by the `rules` CLI command + docs). */
export const RULE_METADATA: RuleMetadata[] = [
  {
    id: "TOOLS-001",
    version: 1,
    category: "tools",
    severity: "medium",
    title: "Repeated unchanged file reads",
    description: "The same file read repeatedly without an intervening write or edit.",
    defaultThresholds: { minOccurrences: 3 },
  },
  {
    id: "TOOLS-002",
    version: 1,
    category: "tools",
    severity: "low",
    title: "Repeated equivalent command",
    description:
      "A normalised command executed repeatedly within a short period (watch/polling distinguished where possible).",
    defaultThresholds: { minOccurrences: 3 },
  },
  {
    id: "TOOLS-003",
    version: 1,
    category: "tools",
    severity: "high",
    title: "Repeated unchanged failure",
    description:
      "Materially identical commands fail repeatedly without a meaningful change in arguments or strategy.",
    defaultThresholds: { minOccurrences: 2 },
  },
  {
    id: "TOOLS-004",
    version: 1,
    category: "tools",
    severity: "low",
    title: "Excessive broad test runs",
    description:
      "A broad/full test suite is repeatedly run after changes limited to a narrow project area. Conservative confidence.",
    defaultThresholds: { minBroadRuns: 3, maxFilesChanged: 2 },
  },
  {
    id: "TOOLS-005",
    version: 1,
    category: "tools",
    severity: "medium",
    title: "Oversized tool result",
    description:
      "Command or tool output is unusually large and likely contributes unnecessary context.",
    defaultThresholds: { minOutputBytes: 200_000 },
  },
  {
    id: "TOOLS-006",
    version: 1,
    category: "tools",
    severity: "low",
    title: "High exploration-to-change ratio",
    description:
      "A session reads/searches many files but changes very few. Moderate confidence — exploration is not always wasteful.",
    defaultThresholds: { minReads: 8, maxFilesChanged: 2 },
  },
  {
    id: "VERIFY-001",
    version: 1,
    category: "verification",
    severity: "high",
    title: "No verification after code changes",
    description: "Code changes occurred but no recognised verification command followed.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-002",
    version: 1,
    category: "verification",
    severity: "medium",
    title: "Changes after final successful verification",
    description: "Files changed after the last successful test, build, lint or typecheck.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-003",
    version: 1,
    category: "verification",
    severity: "high",
    title: "Session ended with failed verification",
    description: "The latest relevant verification command failed and no later success occurred.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "VERIFY-004",
    version: 1,
    category: "verification",
    severity: "low",
    title: "Narrow verification only",
    description:
      "A substantial cross-cutting change received only an obviously narrow verification step. Conservative confidence.",
    defaultThresholds: { minSessions: 1 },
  },
  {
    id: "WORKFLOW-001",
    version: 1,
    category: "workflow",
    severity: "medium",
    title: "Excessive corrective turns",
    description:
      "Multiple user prompts appear to correct, reverse or clarify prior work (deterministic phrases + structural indicators).",
    defaultThresholds: { minCorrective: 3 },
  },
  {
    id: "WORKFLOW-002",
    version: 1,
    category: "workflow",
    severity: "low",
    title: "Very long session with task switching",
    description:
      "Conservative deterministic indicators only in Phase 1; semantic detection in Phase 3.",
    defaultThresholds: { minDurationMs: 3_600_000, minPromptsPerSession: 6 },
  },
  {
    id: "CONTEXT-001",
    version: 1,
    category: "context",
    severity: "medium",
    title: "Frequent compaction",
    description:
      "A session experiences repeated compactions or unusually high pre-compaction context.",
    defaultThresholds: { minCompactions: 2, minPreCompactionTokens: 100_000 },
  },
  {
    id: "CONTEXT-002",
    version: 1,
    category: "context",
    severity: "medium",
    title: "Large repeated outputs",
    description: "Large command outputs repeatedly enter the session.",
    defaultThresholds: { minOutputBytes: 100_000, minRepeatedCommands: 1 },
  },
  {
    id: "SECURITY-001",
    version: 1,
    category: "security",
    severity: "high",
    title: "Sensitive path access",
    description:
      "Access to likely-sensitive files (.env, credentials, private keys, secret directories, cloud credentials). Never exposes the value.",
    defaultThresholds: { minAccesses: 1 },
  },
  {
    id: "SECURITY-002",
    version: 1,
    category: "security",
    severity: "critical",
    title: "Potential secret in persisted content",
    description:
      "The redaction pipeline detected a likely secret. Only the finding category is stored, not the secret.",
    defaultThresholds: { minFindings: 1 },
  },
];

export { tools001, tools002, tools003, tools004, tools005, tools006 } from "./tools.js";
export { verify001, verify002, verify003, verify004 } from "./verify.js";
export { workflow001, workflow002 } from "./workflow.js";
export { context001, context002 } from "./context.js";
export { security001, security002 } from "./security.js";
